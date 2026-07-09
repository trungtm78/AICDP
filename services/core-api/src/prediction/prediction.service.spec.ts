import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { recomputeAll, getPrediction, listPredictions } from "./prediction.service.js";
import {
  PredictionUnavailable, type IPredictionProvider, type MlPrediction,
} from "./prediction.provider.js";
import { recomputeFeature } from "../feature/feature.service.js";

let occId: string;

// Provider giả: luôn throw PredictionUnavailable (mô phỏng ai-service down).
const downProvider: IPredictionProvider = {
  score: async () => { throw new PredictionUnavailable("down"); },
  lookalike: async () => { throw new PredictionUnavailable("down"); },
  health: async () => false,
};

// Provider giả: trả điểm ML cố định.
const mlProvider: IPredictionProvider = {
  score: async (occIds): Promise<MlPrediction[]> => occIds.map((occId) => ({
    occId, churnProb: 0.42, propensity: 0.7, clv: 5_000_000, predictedPurchases: 6.1,
    nextIntervalDays: 21, nextPurchaseAt: new Date().toISOString(),
    reasons: { churn: ["recency cao"], propensity: ["tần suất cao"] },
    modelVersions: { churn: "churn-v1", clv: "clv-v1" },
  })),
  lookalike: async () => [],
  health: async () => true,
};

beforeAll(async () => { await setupTestDb(); });

beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
  await pool.query("INSERT INTO cdp.profile (occ_id, full_name) VALUES ($1,'Nguyễn Test')", [occId]);
  await pool.query(
    `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, store_id, source, pos_transaction_id, total, occ_timestamp)
     VALUES ('m1',$1,'givral','s1','pos','p1',300000, now() - interval '20 days'),
            ('m2',$1,'givral','s1','pos','p2',250000, now() - interval '5 days')`,
    [occId],
  );
  await recomputeFeature(pool, occId); // tạo customer_feature (nguồn heuristic fallback)
});

describe("prediction — fallback khi ai-service down (test quan trọng nhất)", () => {
  it("ai-service down -> recomputeAll dùng heuristic, KHÔNG lỗi, source='heuristic'", async () => {
    const res = await recomputeAll(pool, downProvider);
    expect(res.source).toBe("heuristic");
    expect(res.count).toBeGreaterThanOrEqual(1);
    const list = await listPredictions(pool, {});
    expect(list.total).toBeGreaterThanOrEqual(1);
    expect(list.rows[0]!.scoreSource).toBe("heuristic");
    // CLV heuristic > 0 (từ monetary + avg_basket)
    expect(list.rows[0]!.predictedClv ?? 0).toBeGreaterThan(0);
  });

  it("ai-service OK -> source='ml', ghi model_versions + explain", async () => {
    const res = await recomputeAll(pool, mlProvider);
    expect(res.source).toBe("ml");
    const p = await getPrediction(pool, mlProvider, occId);
    expect(p).not.toBeNull();
    expect(p!.scoreSource).toBe("ml");
    expect(p!.churnProb).toBeCloseTo(0.42, 3);
    expect(p!.modelVersions.churn).toBe("churn-v1");
    expect(p!.explain.propensity).toContain("tần suất cao");
  });

  it("getPrediction on-demand khi chưa có: down -> heuristic", async () => {
    const p = await getPrediction(pool, downProvider, occId);
    expect(p).not.toBeNull();
    expect(p!.scoreSource).toBe("heuristic");
  });
});
