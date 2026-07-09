import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeFeature } from "../feature/feature.service.js";
import { previewSegment } from "./segment.service.js";
import { lookalike } from "./lookalike.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

async function order(phone: string, brand: string, txn: string, total: number) {
  return ingestOrderCompleted(pool, {
    brand_id: brand, store_id: "s1", source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: txn, total },
  });
}

async function setPrediction(occId: string, churn: number, prop: number, clv: number) {
  await pool.query(
    `INSERT INTO cdp.customer_prediction (occ_id, churn_prob, propensity, predicted_clv, score_source)
     VALUES ($1,$2,$3,$4,'heuristic')`,
    [occId, churn, prop, clv],
  );
}

describe("segment — tiêu chí dự đoán (customer_prediction)", () => {
  it("churnProbGte lọc khách nguy cơ rời cao", async () => {
    const a = await order("0901000001", "givral", "t1", 300000);
    const b = await order("0901000002", "givral", "t2", 200000);
    await setPrediction(a.occId, 0.8, 0.1, 5_000_000);
    await setPrediction(b.occId, 0.2, 0.7, 3_000_000);

    const seg = await previewSegment(pool, { churnProbGte: 0.5 });
    expect(seg.occIds).toEqual([a.occId]);
  });

  it("kết hợp propensityGte + clvMin", async () => {
    const a = await order("0901000001", "givral", "t1", 300000);
    const b = await order("0901000002", "givral", "t2", 200000);
    await setPrediction(a.occId, 0.2, 0.8, 12_000_000);
    await setPrediction(b.occId, 0.2, 0.8, 4_000_000);

    const seg = await previewSegment(pool, { propensityGte: 0.5, clvMin: 10_000_000 });
    expect(seg.occIds).toEqual([a.occId]);
  });
});

describe("lookalike — mở rộng audience theo tương đồng RFM", () => {
  it("trả khách tương đồng seed (loại seed), sắp theo similarity", async () => {
    // 2 khách 'giống' (chi tiêu cao, nhiều đơn) + 1 khách khác hẳn (1 đơn nhỏ)
    const a = await order("0901000001", "givral", "a1", 500000);
    await order("0901000001", "givral", "a2", 500000);
    const b = await order("0901000002", "givral", "b1", 480000);
    await order("0901000002", "givral", "b2", 520000);
    const c = await order("0901000003", "fuji", "c1", 50000);
    for (const occ of [a.occId, b.occId, c.occId]) await recomputeFeature(pool, occ);

    const res = await lookalike(pool, [a.occId], 10);
    expect(res.find((r) => r.occId === a.occId)).toBeUndefined(); // loại seed
    expect(res.length).toBeGreaterThanOrEqual(1);
    // b (giống a) đứng trước c (khác hẳn)
    const rankB = res.findIndex((r) => r.occId === b.occId);
    const rankC = res.findIndex((r) => r.occId === c.occId);
    expect(rankB).toBeGreaterThanOrEqual(0);
    expect(rankB).toBeLessThan(rankC);
  });

  it("seed rỗng -> []", async () => {
    expect(await lookalike(pool, [], 10)).toEqual([]);
  });
});
