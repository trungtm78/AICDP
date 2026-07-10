import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeFeature } from "../feature/feature.service.js";
import { rfmMatrix, cohortRetention, conversionFunnel } from "./advanced.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

async function order(phone: string, brand: string, txn: string, total: number, ts: string) {
  return ingestOrderCompleted(pool, {
    brand_id: brand, store_id: "s1", source: "pos", occ_timestamp: ts,
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: txn, total },
  });
}

describe("advanced analytics", () => {
  it("conversionFunnel: bước sau ⊆ bước trước (đơn điệu giảm)", async () => {
    // a: 1 đơn; b: 2 đơn 2 brand; c: 4 đơn
    const a = await order("0901000001", "givral", "a1", 100000, "2026-01-01T00:00:00Z");
    const b = await order("0901000002", "givral", "b1", 100000, "2026-01-01T00:00:00Z");
    await order("0901000002", "fuji", "b2", 100000, "2026-02-01T00:00:00Z");
    const c = await order("0901000003", "givral", "c1", 100000, "2026-01-01T00:00:00Z");
    await order("0901000003", "givral", "c2", 100000, "2026-02-01T00:00:00Z");
    await order("0901000003", "givral", "c3", 100000, "2026-03-01T00:00:00Z");
    await order("0901000003", "givral", "c4", 100000, "2026-04-01T00:00:00Z");
    for (const o of [a, b, c]) await recomputeFeature(pool, o.occId);

    const f = await conversionFunnel(pool, ["identified", "purchased", "repeat", "multibrand", "loyal"]);
    const counts = f.steps.map((s) => s.count);
    expect(counts[0]).toBe(3); // identified: 3 khách
    expect(counts[1]).toBe(3); // purchased: 3
    expect(counts[2]).toBe(2); // repeat >=2: b,c
    expect(counts[3]).toBe(1); // multibrand: b
    expect(counts[4]).toBe(1); // loyal >=4: c
    // đơn điệu giảm
    for (let i = 1; i < counts.length; i++) expect(counts[i]!).toBeLessThanOrEqual(counts[i - 1]!);
  });

  it("rfmMatrix: tổng cells = số khách có giao dịch", async () => {
    for (let i = 0; i < 10; i++) {
      const o = await order(`090100${i.toString().padStart(4, "0")}`, "givral", `t${i}`, 100000 * (i + 1), "2026-05-01T00:00:00Z");
      await recomputeFeature(pool, o.occId);
    }
    const m = await rfmMatrix(pool);
    expect(m.total).toBe(10);
    expect(m.rLabels.length).toBe(5);
    expect(m.fLabels.length).toBe(5);
  });

  it("cohortRetention: offset 0 = 100% (kích thước cohort)", async () => {
    const a = await order("0901000001", "givral", "a1", 100000, "2026-01-15T00:00:00Z");
    await order("0901000001", "givral", "a2", 100000, "2026-03-15T00:00:00Z"); // offset 2
    await recomputeFeature(pool, a.occId);
    const c = await cohortRetention(pool);
    const jan = c.cohorts.find((x) => x.cohort === "2026-01");
    expect(jan).toBeDefined();
    expect(jan!.retention[0]).toBe(1); // offset 0 luôn 100%
  });
});
