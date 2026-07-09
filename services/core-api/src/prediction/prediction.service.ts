import type { Pool } from "pg";
import { PredictionUnavailable, type IPredictionProvider, type MlPrediction } from "./prediction.provider.js";

// Kho dự đoán (customer_prediction). recomputeAll gọi ai-service (ML); nếu ai-service down →
// FALLBACK heuristic từ customer_feature (score_source='heuristic'). Honest-labeling ở cột
// score_source + model_versions. decisioning/segment/analytics đọc bảng này.

const DAY_MS = 86_400_000;

export interface CustomerPrediction {
  occId: string;
  fullName: string | null;
  predictedClv: number | null;
  predictedPurchases: number | null;
  churnProb: number | null;
  propensity: number | null;
  nextPurchaseAt: string | null;
  nextIntervalDays: number | null;
  scoreSource: "ml" | "heuristic";
  modelVersions: Record<string, string>;
  explain: Record<string, string[]>;
  computedAt: string;
}

interface UpsertRow {
  occId: string;
  churnProb: number;
  propensity: number;
  clv: number;
  predictedPurchases: number;
  nextIntervalDays: number;
  nextPurchaseAt: string | null;
  source: "ml" | "heuristic";
  modelVersions: Record<string, string>;
  explain: Record<string, string[]>;
}

async function upsertPredictions(pool: Pool, rows: UpsertRow[]): Promise<void> {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO cdp.customer_prediction
         (occ_id, predicted_clv, predicted_purchases, churn_prob, propensity,
          next_purchase_at, next_interval_days, score_source, model_versions, explain, computed_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb, now(), now())
       ON CONFLICT (occ_id) DO UPDATE SET
         predicted_clv=EXCLUDED.predicted_clv, predicted_purchases=EXCLUDED.predicted_purchases,
         churn_prob=EXCLUDED.churn_prob, propensity=EXCLUDED.propensity,
         next_purchase_at=EXCLUDED.next_purchase_at, next_interval_days=EXCLUDED.next_interval_days,
         score_source=EXCLUDED.score_source, model_versions=EXCLUDED.model_versions,
         explain=EXCLUDED.explain, computed_at=now(), updated_at=now()`,
      [
        r.occId, r.clv, r.predictedPurchases, r.churnProb, r.propensity,
        r.nextPurchaseAt, r.nextIntervalDays, r.source,
        JSON.stringify(r.modelVersions), JSON.stringify(r.explain),
      ],
    );
  }
}

function mlToUpsert(p: MlPrediction): UpsertRow {
  return {
    occId: p.occId, churnProb: p.churnProb, propensity: p.propensity, clv: p.clv,
    predictedPurchases: p.predictedPurchases, nextIntervalDays: p.nextIntervalDays,
    nextPurchaseAt: p.nextPurchaseAt, source: "ml", modelVersions: p.modelVersions,
    explain: { churn: p.reasons.churn, propensity: p.reasons.propensity },
  };
}

/** Fallback heuristic từ customer_feature (khi ai-service không sẵn). */
async function heuristicRows(pool: Pool, occIds: string[] | null): Promise<UpsertRow[]> {
  const params: unknown[] = [];
  let where = "1=1";
  if (occIds && occIds.length > 0) {
    params.push(occIds);
    where = "occ_id = ANY($1)";
  }
  const r = await pool.query<{
    occ_id: string; churn_risk: string | null; propensity_score: string | null;
    monetary: string; avg_basket: string; frequency: string; last_order_at: string | null;
  }>(
    `SELECT occ_id::text, churn_risk, propensity_score, monetary, avg_basket, frequency, last_order_at
       FROM cdp.customer_feature WHERE ${where}`,
    params,
  );
  const now = Date.now();
  return r.rows.map((f) => {
    const churn = f.churn_risk === null ? 0 : Number(f.churn_risk);
    const prop = f.propensity_score === null ? 0 : Number(f.propensity_score);
    const monetary = Number(f.monetary);
    const avgBasket = Number(f.avg_basket);
    // CLV heuristic (labeled): tổng chi tiêu + 4 lần đơn trung bình (thô, chỉ dùng khi ML down).
    const clv = Math.round(monetary + avgBasket * 4);
    const interval = 30; // heuristic mặc định
    const base = f.last_order_at ? new Date(f.last_order_at).getTime() : now;
    const nextAt = new Date(Math.max(base, now) + interval * DAY_MS).toISOString();
    return {
      occId: f.occ_id, churnProb: churn, propensity: prop, clv, predictedPurchases: 0,
      nextIntervalDays: interval, nextPurchaseAt: nextAt, source: "heuristic" as const,
      modelVersions: {}, explain: {},
    };
  });
}

/** Batch: thử ML (ai-service) → fallback heuristic. Trả số khách đã tính + nguồn. */
export async function recomputeAll(
  pool: Pool,
  provider: IPredictionProvider,
): Promise<{ count: number; source: "ml" | "heuristic" }> {
  const ids = await pool.query<{ occ_id: string }>(
    "SELECT DISTINCT occ_id::text FROM cdp.canonical_transaction WHERE occ_id IS NOT NULL",
  );
  const occIds = ids.rows.map((x) => x.occ_id);
  try {
    const ml = await provider.score(occIds);
    if (ml.length > 0) {
      await upsertPredictions(pool, ml.map(mlToUpsert));
      return { count: ml.length, source: "ml" };
    }
    // ai-service chưa có model → dùng heuristic
  } catch (err) {
    if (!(err instanceof PredictionUnavailable)) throw err;
  }
  const rows = await heuristicRows(pool, occIds);
  await upsertPredictions(pool, rows);
  return { count: rows.length, source: "heuristic" };
}

const SELECT_PRED = `
  SELECT cp.occ_id::text, p.full_name, cp.predicted_clv, cp.predicted_purchases,
         cp.churn_prob, cp.propensity, cp.next_purchase_at, cp.next_interval_days,
         cp.score_source, cp.model_versions, cp.explain, cp.computed_at
    FROM cdp.customer_prediction cp
    LEFT JOIN cdp.profile p ON p.occ_id = cp.occ_id`;

function mapPrediction(row: Record<string, unknown>): CustomerPrediction {
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    occId: row.occ_id as string,
    fullName: (row.full_name as string | null) ?? null,
    predictedClv: num(row.predicted_clv),
    predictedPurchases: num(row.predicted_purchases),
    churnProb: num(row.churn_prob),
    propensity: num(row.propensity),
    nextPurchaseAt: (row.next_purchase_at as string | null) ?? null,
    nextIntervalDays: num(row.next_interval_days),
    scoreSource: (row.score_source as "ml" | "heuristic") ?? "heuristic",
    modelVersions: (row.model_versions as Record<string, string>) ?? {},
    explain: (row.explain as Record<string, string[]>) ?? {},
    computedAt: row.computed_at as string,
  };
}

/** Đọc dự đoán 1 khách; nếu chưa có → tính on-demand (ML nếu được, else heuristic). */
export async function getPrediction(
  pool: Pool,
  provider: IPredictionProvider,
  occId: string,
): Promise<CustomerPrediction | null> {
  const existing = await pool.query(`${SELECT_PRED} WHERE cp.occ_id=$1`, [occId]);
  if (existing.rows[0]) return mapPrediction(existing.rows[0]);
  // chưa có: tính on-demand
  try {
    const ml = await provider.score([occId]);
    if (ml[0]) await upsertPredictions(pool, [mlToUpsert(ml[0])]);
  } catch (err) {
    if (!(err instanceof PredictionUnavailable)) throw err;
    const rows = await heuristicRows(pool, [occId]);
    await upsertPredictions(pool, rows);
  }
  const r = await pool.query(`${SELECT_PRED} WHERE cp.occ_id=$1`, [occId]);
  return r.rows[0] ? mapPrediction(r.rows[0]) : null;
}

const MODEL_SORT: Record<string, string> = {
  churn: "cp.churn_prob DESC NULLS LAST",
  propensity: "cp.propensity DESC NULLS LAST",
  clv: "cp.predicted_clv DESC NULLS LAST",
  next_purchase: "cp.next_purchase_at ASC NULLS LAST",
};

/** Danh sách dự đoán có phân trang, sắp theo model chọn. */
export async function listPredictions(
  pool: Pool,
  opts: { model?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: CustomerPrediction[]; total: number }> {
  const order = MODEL_SORT[opts.model ?? "churn"] ?? MODEL_SORT.churn;
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const total = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM cdp.customer_prediction");
  const r = await pool.query(`${SELECT_PRED} ORDER BY ${order} LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: r.rows.map(mapPrediction), total: Number(total.rows[0]?.n ?? 0) };
}

/** Histogram phân phối điểm theo bucket (10 khoảng) cho metric churn/propensity/clv. */
export async function getDistribution(pool: Pool, metric: string): Promise<{ bucket: string; count: number }[]> {
  const col = metric === "propensity" ? "propensity" : metric === "clv" ? "predicted_clv" : "churn_prob";
  if (col === "predicted_clv") {
    const r = await pool.query<{ bucket: number; count: string }>(
      `SELECT width_bucket(predicted_clv, 0, GREATEST((SELECT max(predicted_clv) FROM cdp.customer_prediction),1), 10) AS bucket,
              count(*)::text AS count
         FROM cdp.customer_prediction WHERE predicted_clv IS NOT NULL GROUP BY 1 ORDER BY 1`,
    );
    return r.rows.map((x) => ({ bucket: `B${x.bucket}`, count: Number(x.count) }));
  }
  const r = await pool.query<{ bucket: number; count: string }>(
    `SELECT width_bucket(${col}, 0, 1, 10) AS bucket, count(*)::text AS count
       FROM cdp.customer_prediction WHERE ${col} IS NOT NULL GROUP BY 1 ORDER BY 1`,
  );
  return r.rows.map((x) => ({ bucket: `${((x.bucket - 1) * 10)}-${x.bucket * 10}%`, count: Number(x.count) }));
}

export interface ModelCard {
  modelType: string;
  modelVersion: string;
  algorithm: string;
  metricName: string;
  metricValue: number;
  sampleSize: number | null;
  isDemo: boolean;
  trainedAt: string;
  featureImportance: { feature: string; weight: number }[];
}

/** Model card + feature importance (UI Predictive Studio). Rỗng nếu ai-service chưa train. */
export async function getModelCards(pool: Pool): Promise<ModelCard[]> {
  const cards = await pool.query<{
    model_type: string; model_version: string; algorithm: string; metric_name: string;
    metric_value: string; sample_size: number | null; is_demo: boolean; trained_at: string;
  }>("SELECT * FROM cdp.model_card ORDER BY model_type");
  const imp = await pool.query<{ model_type: string; feature: string; weight: string }>(
    "SELECT model_type, feature, weight FROM cdp.model_feature_importance ORDER BY model_type, abs(weight) DESC",
  );
  return cards.rows.map((c) => ({
    modelType: c.model_type, modelVersion: c.model_version, algorithm: c.algorithm,
    metricName: c.metric_name, metricValue: Number(c.metric_value), sampleSize: c.sample_size,
    isDemo: c.is_demo, trainedAt: c.trained_at,
    featureImportance: imp.rows.filter((i) => i.model_type === c.model_type)
      .map((i) => ({ feature: i.feature, weight: Number(i.weight) })),
  }));
}
