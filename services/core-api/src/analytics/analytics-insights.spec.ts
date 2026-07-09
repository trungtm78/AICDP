import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeAllFeatures } from "../feature/feature.service.js";
import { getInsights } from "./analytics.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  await pool.query(`INSERT INTO cdp.product_category (category_id, name) VALUES ('banh','Bánh'),('kem','Kem')`);
  await pool.query(`INSERT INTO cdp.product_master (product_master_id, name, category_id) VALUES ('PM-B','Bánh','banh'),('PM-K','Kem','kem')`);
  await pool.query(`INSERT INTO cdp.sku_mapping (brand_id, pos_sku, product_master_id) VALUES ('givral','PM-B','PM-B'),('kem_trang_tien','PM-K','PM-K')`);
});

let n = 0;
function order(brand: string, sku: string, phone: string, total: number) {
  n++;
  return {
    brand_id: brand, store_id: "s1", source: "pos", occ_timestamp: "2026-06-15T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: `I-${n}`, total, items: [{ sku, name: sku, quantity: 1, unit_price: total }] },
  };
}
const ing = (o: unknown) => ingestOrderCompleted(pool, o as never);

describe("analytics — getInsights (PG)", () => {
  it("trả lifecycle, revenueByBrand, topCategories, crossBrand", async () => {
    // Khách A: mua 2 brand (cross-brand)
    await ing(order("givral", "PM-B", "0900000001", 300000));
    await ing(order("kem_trang_tien", "PM-K", "0900000001", 100000));
    // Khách B: 1 brand
    await ing(order("givral", "PM-B", "0900000002", 200000));
    await recomputeAllFeatures(pool, new Date("2026-06-18T00:00:00.000Z"));

    const ins = await getInsights(pool);
    expect(ins.totalWithFeature).toBe(2);
    expect(ins.crossBrandCustomers).toBe(1); // khách A
    expect(ins.lifecycle.reduce((s, x) => s + x.count, 0)).toBe(2);
    // doanh thu givral (300k+200k=500k) > kem_trang_tien (100k)
    const rev = Object.fromEntries(ins.revenueByBrand.map((x) => [x.brandId, x.revenue]));
    expect(rev["givral"]).toBe(500000);
    expect(rev["kem_trang_tien"]).toBe(100000);
    // nhóm hàng: banh + kem
    const cats = ins.topCategories.map((c) => c.category);
    expect(cats).toContain("banh");
    expect(cats).toContain("kem");
  });

  it("DB trống -> insights rỗng, không lỗi", async () => {
    const ins = await getInsights(pool);
    expect(ins.totalWithFeature).toBe(0);
    expect(ins.lifecycle).toEqual([]);
    expect(ins.avgChurnRisk).toBe(0);
  });
});
