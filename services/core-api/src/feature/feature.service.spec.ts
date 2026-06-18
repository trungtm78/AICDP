import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeFeature, recomputeAllFeatures, getFeature } from "./feature.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  // master + crosswalk để resolve category (cross-brand)
  await pool.query(`INSERT INTO cdp.product_category (category_id, name) VALUES ('banh','Bánh'),('kem','Kem')`);
  await pool.query(
    `INSERT INTO cdp.product_master (product_master_id, name, category_id)
     VALUES ('PM-BANH','Bánh kem','banh'),('PM-KEM','Kem ly','kem')`,
  );
  await pool.query(
    `INSERT INTO cdp.sku_mapping (brand_id, pos_sku, product_master_id)
     VALUES ('givral','GV-01','PM-BANH'),('kem_trang_tien','KT-01','PM-KEM')`,
  );
});

const TS = "2026-06-10T03:00:00.000Z";
const NOW = new Date("2026-06-18T03:00:00.000Z"); // recency = 8 ngày

function order(brand: string, sku: string, posTxn: string, total: number, phone: string) {
  return {
    brand_id: brand, store_id: "s1", source: "pos", occ_timestamp: TS,
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: posTxn, total, items: [{ sku, name: sku, quantity: 1, unit_price: total }] },
  };
}

async function seedCustomer(phone: string): Promise<string> {
  // pos_txn duy nhất theo phone (idempotency key = {brand}:{store}:{pos_txn}, KHÔNG theo phone)
  const s = phone.slice(-4);
  await ingestOrderCompleted(pool, order("givral", "GV-01", `T1-${s}`, 100000, phone) as never);
  await ingestOrderCompleted(pool, order("givral", "GV-01", `T2-${s}`, 200000, phone) as never);
  const r = await ingestOrderCompleted(pool, order("kem_trang_tien", "KT-01", `T3-${s}`, 300000, phone) as never);
  return r.occId!;
}

describe("feature — recompute (RFM + cross-brand + category)", () => {
  it("3 đơn 2 brand -> frequency=3, distinct_brands=2, monetary=600k, avg=200k", async () => {
    const occId = await seedCustomer("0901234567");
    const f = await recomputeFeature(pool, occId, NOW);
    expect(f.frequency).toBe(3);
    expect(f.distinctBrands).toBe(2);
    expect(f.monetary).toBe(600000);
    expect(f.avgBasket).toBe(200000);
    expect(f.recencyDays).toBe(8);
    expect(f.lifecycleStage).toBe("active");
  });

  it("favorite_category = category mua nhiều nhất (banh: 2 dòng > kem: 1)", async () => {
    const occId = await seedCustomer("0901234568");
    const f = await recomputeFeature(pool, occId, NOW);
    expect(f.distinctCategories).toBe(2);
    expect(f.favoriteCategory).toBe("banh");
  });

  it("loyalty_available phản ánh balance (mặc định 0 khi chưa earn)", async () => {
    const occId = await seedCustomer("0901234569");
    const f = await recomputeFeature(pool, occId, NOW);
    expect(f.loyaltyAvailable).toBe(0);
  });

  it("upsert idempotent: gọi 2 lần -> 1 row", async () => {
    const occId = await seedCustomer("0901234570");
    await recomputeFeature(pool, occId, NOW);
    await recomputeFeature(pool, occId, NOW);
    const cnt = await pool.query<{ n: string }>(
      "SELECT count(*)::int AS n FROM cdp.customer_feature WHERE occ_id=$1",
      [occId],
    );
    expect(Number(cnt.rows[0]!.n)).toBe(1);
  });

  it("getFeature trả đúng dữ liệu đã tính; null khi chưa tính", async () => {
    const occId = await seedCustomer("0901234571");
    expect(await getFeature(pool, occId)).toBeNull();
    await recomputeFeature(pool, occId, NOW);
    const f = await getFeature(pool, occId);
    expect(f?.frequency).toBe(3);
    expect(f?.favoriteCategory).toBe("banh");
  });

  it("recomputeAllFeatures tính cho mọi khách có giao dịch", async () => {
    await seedCustomer("0901234572");
    await seedCustomer("0901234573");
    const res = await recomputeAllFeatures(pool, NOW);
    expect(res.count).toBe(2);
  });
});
