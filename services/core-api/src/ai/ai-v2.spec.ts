import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recommendV2 } from "./ai.service.js";
import type { AiConfig } from "../ai-config/ai-config.service.js";

const RECO: AiConfig["reco"] = {
  topN: 10,
  diversityWeight: 0.3,
  enableCrossBrand: true,
  enableMarketBasket: true,
  boost: [],
  bury: [],
};

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  await pool.query(`INSERT INTO cdp.product_category (category_id, name) VALUES ('banh','Bánh'),('kem','Kem')`);
  await pool.query(
    `INSERT INTO cdp.product_master (product_master_id, name, category_id) VALUES
      ('PM-BANH','Bánh kem','banh'),('PM-COFFEE','Cà phê','banh'),('PM-KEM','Kem ly','kem')`,
  );
  await pool.query(
    `INSERT INTO cdp.sku_mapping (brand_id, pos_sku, product_master_id) VALUES
      ('givral','GV-01','PM-BANH'),('givral','GV-02','PM-COFFEE'),('kem_trang_tien','KT-01','PM-KEM')`,
  );
});

function order(brand: string, items: { sku: string }[], posTxn: string, phone: string) {
  return {
    brand_id: brand, store_id: "s1", source: "pos", occ_timestamp: "2026-06-10T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: {
      pos_transaction_id: posTxn, total: 100000,
      items: items.map((i) => ({ sku: i.sku, name: i.sku, quantity: 1, unit_price: 100000 })),
    },
  };
}
const ing = (o: unknown) => ingestOrderCompleted(pool, o as never);

describe("recommendV2 — cross-brand NBA + market-basket + diversity", () => {
  it("cross-brand: peer mua givral + kem_trang_tien -> gợi ý sản phẩm brand khác (source cross_brand)", async () => {
    const a = (await ing(order("givral", [{ sku: "GV-01" }], "A1", "0900000001"))).occId!;
    // peer B: cùng mua PM-BANH (givral) + có đơn brand kem_trang_tien (PM-KEM)
    await ing(order("givral", [{ sku: "GV-01" }], "B1", "0900000002"));
    await ing(order("kem_trang_tien", [{ sku: "KT-01" }], "B2", "0900000002"));

    const recs = await recommendV2(pool, a, RECO);
    const kem = recs.find((r) => r.productMasterId === "PM-KEM");
    expect(kem).toBeTruthy();
    expect(kem!.source).toBe("cross_brand");
    expect(kem!.brandId).toBe("kem_trang_tien");
  });

  it("market-basket: sản phẩm đồng xuất hiện cùng giỏ với SP đã mua -> basket signal", async () => {
    const a = (await ing(order("givral", [{ sku: "GV-01" }], "A1", "0900000003"))).occId!;
    // C: 1 giỏ có GV-01 + GV-02 (PM-COFFEE đồng xuất hiện PM-BANH)
    await ing(order("givral", [{ sku: "GV-01" }, { sku: "GV-02" }], "C1", "0900000004"));

    const recs = await recommendV2(pool, a, RECO);
    const coffee = recs.find((r) => r.productMasterId === "PM-COFFEE");
    expect(coffee).toBeTruthy();
    expect(coffee!.reasons.some((x) => x.includes("market-basket"))).toBe(true);
  });

  it("loại sản phẩm khách đã mua khỏi gợi ý", async () => {
    const a = (await ing(order("givral", [{ sku: "GV-01" }], "A1", "0900000005"))).occId!;
    await ing(order("givral", [{ sku: "GV-01" }, { sku: "GV-02" }], "B1", "0900000006"));
    const recs = await recommendV2(pool, a, RECO);
    expect(recs.find((r) => r.productMasterId === "PM-BANH")).toBeUndefined();
  });

  it("bury: sản phẩm trong bury list bị loại", async () => {
    const a = (await ing(order("givral", [{ sku: "GV-01" }], "A1", "0900000007"))).occId!;
    await ing(order("givral", [{ sku: "GV-01" }], "B1", "0900000008"));
    await ing(order("kem_trang_tien", [{ sku: "KT-01" }], "B2", "0900000008"));
    const recs = await recommendV2(pool, a, { ...RECO, bury: ["PM-KEM"] });
    expect(recs.find((r) => r.productMasterId === "PM-KEM")).toBeUndefined();
  });

  it("enableCrossBrand=false -> không gợi ý sản phẩm brand khác", async () => {
    const a = (await ing(order("givral", [{ sku: "GV-01" }], "A1", "0900000009"))).occId!;
    await ing(order("givral", [{ sku: "GV-01" }], "B1", "0900000010"));
    await ing(order("kem_trang_tien", [{ sku: "KT-01" }], "B2", "0900000010"));
    const recs = await recommendV2(pool, a, { ...RECO, enableCrossBrand: false });
    expect(recs.find((r) => r.brandId === "kem_trang_tien")).toBeUndefined();
  });
});
