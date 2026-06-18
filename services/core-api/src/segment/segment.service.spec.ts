import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { previewSegment } from "./segment.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

async function order(phone: string, brand: string, txn: string, total: number) {
  return ingestOrderCompleted(pool, {
    brand_id: brand,
    store_id: "s1",
    source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: txn, total },
  });
}

describe("segment — preview theo tiêu chí", () => {
  it("lọc theo brand + tổng chi tiêu tối thiểu", async () => {
    const a = await order("0901000001", "givral", "s-a1", 300000); // givral 300k
    const b = await order("0901000002", "givral", "s-b1", 100000); // givral 100k
    await order("0901000003", "fuji", "s-c1", 500000); // fuji 500k (khác brand)

    const seg = await previewSegment(pool, { brandId: "givral", minSpend: 250000 });
    expect(seg.count).toBe(1);
    expect(seg.occIds).toEqual([a.occId]);
    expect(seg.occIds).not.toContain(b.occId);
  });

  it("không tiêu chí -> mọi khách có giao dịch", async () => {
    const a = await order("0901000001", "givral", "s-a1", 100000);
    const b = await order("0901000002", "fuji", "s-b1", 100000);
    const seg = await previewSegment(pool, {});
    expect(seg.count).toBe(2);
    expect(seg.occIds.sort()).toEqual([a.occId, b.occId].sort());
  });

  it("minTransactions lọc khách có >= N giao dịch", async () => {
    const a = await order("0901000001", "givral", "s-a1", 100000);
    await order("0901000001", "givral", "s-a2", 100000); // a có 2 giao dịch
    await order("0901000002", "givral", "s-b1", 100000); // b có 1

    const seg = await previewSegment(pool, { minTransactions: 2 });
    expect(seg.occIds).toEqual([a.occId]);
  });
});
