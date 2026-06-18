import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recommendForCustomer } from "./ai.service.js";

let txn = 0;
async function buy(phone: string, skus: string[]): Promise<string> {
  const r = await ingestOrderCompleted(pool, {
    brand_id: "givral",
    store_id: "s1",
    source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: {
      pos_transaction_id: `T-${++txn}`,
      total: 1000,
      items: skus.map((sku) => ({ sku, name: `Tên ${sku}`, quantity: 1, unit_price: 1000 })),
    },
  });
  return r.occId!;
}

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  txn = 0;
});

describe("ai — cross-sell next-best-product (collaborative)", () => {
  it("gợi ý sản phẩm khách CHƯA mua, xếp theo số peer cùng mua", async () => {
    const a = await buy("0901000001", ["P1", "P2"]); // khách mục tiêu
    await buy("0901000002", ["P1", "P3"]); // peer qua P1 -> gợi ý P3
    await buy("0901000003", ["P2", "P3", "P4"]); // peer qua P2 -> gợi ý P3, P4

    const recs = await recommendForCustomer(pool, a, 10);
    const bySku = Object.fromEntries(recs.map((r) => [r.sku, r.score]));
    expect(recs.map((r) => r.sku)).not.toContain("P1"); // đã mua
    expect(recs.map((r) => r.sku)).not.toContain("P2");
    expect(bySku["P3"]).toBe(2); // cả 2 peer cùng mua
    expect(bySku["P4"]).toBe(1);
    expect(recs[0]!.sku).toBe("P3"); // xếp hạng cao nhất trước
    expect(recs[0]!.name).toBe("Tên P3");
  });

  it("khách chưa có giao dịch -> không gợi ý (rỗng)", async () => {
    const r = await pool.query<{ occ_id: string }>(
      "INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id",
    );
    const recs = await recommendForCustomer(pool, r.rows[0]!.occ_id, 10);
    expect(recs).toEqual([]);
  });

  it("tôn trọng limit", async () => {
    const a = await buy("0901000001", ["P1"]);
    await buy("0901000002", ["P1", "P2", "P3", "P4", "P5"]);
    const recs = await recommendForCustomer(pool, a, 2);
    expect(recs.length).toBe(2);
  });
});
