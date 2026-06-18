import type { Pool } from "pg";
import { getBalance } from "../loyalty/loyalty.service.js";
import { getConfig } from "../ai-config/ai-config.service.js";
import { scoreCustomer, type LifecycleStage } from "../scoring/scoring.service.js";

// Customer Feature (point-in-time): thu thập hành vi khách HỢP NHẤT XUYÊN THƯƠNG HIỆU
// (distinct_brands, favorite_category) + RFM + loyalty + lifecycle/score. recomputeFeature
// on-demand (1 khách); recomputeAllFeatures batch (endpoint admin). Phase B thay nguồn batch
// bằng ClickHouse MV — GIỮ NGUYÊN signature.

const DAY_MS = 86_400_000;

export interface CustomerFeature {
  occId: string;
  recencyDays: number | null;
  frequency: number;
  monetary: number;
  avgBasket: number;
  distinctBrands: number;
  distinctCategories: number;
  favoriteCategory: string | null;
  loyaltyAvailable: number;
  lastOrderAt: string | null;
  lifecycleStage: LifecycleStage | null;
  propensityScore: number | null;
  churnRisk: number | null;
  featureVersion: string;
  computedAt: string;
}

interface AggRow {
  frequency: string;
  monetary: string | null;
  last_order_at: string | null;
  distinct_brands: string;
}

/** Tính lại feature cho 1 khách từ giao dịch + loyalty + crosswalk; chấm điểm; upsert. */
export async function recomputeFeature(
  pool: Pool,
  occId: string,
  now: Date = new Date(),
): Promise<CustomerFeature> {
  const cfg = await getConfig(pool);

  const agg = await pool.query<AggRow>(
    `SELECT count(*)::int            AS frequency,
            sum(total)               AS monetary,
            max(occ_timestamp)       AS last_order_at,
            count(DISTINCT brand_id)::int AS distinct_brands
       FROM cdp.canonical_transaction
      WHERE occ_id = $1`,
    [occId],
  );
  const a = agg.rows[0]!;
  const frequency = Number(a.frequency);
  const monetary = a.monetary === null ? 0 : Number(a.monetary);
  const lastOrderAt = a.last_order_at;
  const distinctBrands = Number(a.distinct_brands);
  const avgBasket = frequency > 0 ? Math.round(monetary / frequency) : 0;
  const recencyDays =
    lastOrderAt === null ? null : Math.floor((now.getTime() - new Date(lastOrderAt).getTime()) / DAY_MS);

  // Category affinity từ view enrich (cross-brand qua sku_mapping -> product_master -> category).
  const cat = await pool.query<{ distinct_categories: string; favorite_category: string | null }>(
    `SELECT count(DISTINCT category_id)::int AS distinct_categories,
            (SELECT category_id FROM cdp.v_purchase_enriched
               WHERE occ_id = $1 AND category_id IS NOT NULL
               GROUP BY category_id ORDER BY count(*) DESC, category_id LIMIT 1) AS favorite_category
       FROM cdp.v_purchase_enriched WHERE occ_id = $1 AND category_id IS NOT NULL`,
    [occId],
  );
  const distinctCategories = Number(cat.rows[0]?.distinct_categories ?? 0);
  const favoriteCategory = cat.rows[0]?.favorite_category ?? null;

  const { available: loyaltyAvailable } = await getBalance(pool, occId);

  const score = scoreCustomer({ recencyDays, frequency, monetary }, cfg.rfm);

  const up = await pool.query<{ computed_at: string }>(
    `INSERT INTO cdp.customer_feature
       (occ_id, recency_days, frequency, monetary, avg_basket, distinct_brands,
        distinct_categories, favorite_category, loyalty_available, last_order_at,
        lifecycle_stage, propensity_score, churn_risk, feature_version, computed_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'v0', now(), now())
     ON CONFLICT (occ_id) DO UPDATE SET
        recency_days=EXCLUDED.recency_days, frequency=EXCLUDED.frequency, monetary=EXCLUDED.monetary,
        avg_basket=EXCLUDED.avg_basket, distinct_brands=EXCLUDED.distinct_brands,
        distinct_categories=EXCLUDED.distinct_categories, favorite_category=EXCLUDED.favorite_category,
        loyalty_available=EXCLUDED.loyalty_available, last_order_at=EXCLUDED.last_order_at,
        lifecycle_stage=EXCLUDED.lifecycle_stage, propensity_score=EXCLUDED.propensity_score,
        churn_risk=EXCLUDED.churn_risk, feature_version='v0', computed_at=now(), updated_at=now()
     RETURNING computed_at`,
    [
      occId, recencyDays, frequency, monetary, avgBasket, distinctBrands,
      distinctCategories, favoriteCategory, loyaltyAvailable, lastOrderAt,
      score.lifecycleStage, score.propensityScore, score.churnRisk,
    ],
  );

  return {
    occId, recencyDays, frequency, monetary, avgBasket, distinctBrands,
    distinctCategories, favoriteCategory, loyaltyAvailable, lastOrderAt,
    lifecycleStage: score.lifecycleStage, propensityScore: score.propensityScore,
    churnRisk: score.churnRisk, featureVersion: "v0", computedAt: up.rows[0]!.computed_at,
  };
}

/** Batch: tính lại feature cho mọi occ_id từng có giao dịch. Trả số khách đã tính. */
export async function recomputeAllFeatures(pool: Pool, now: Date = new Date()): Promise<{ count: number }> {
  const r = await pool.query<{ occ_id: string }>(
    "SELECT DISTINCT occ_id FROM cdp.canonical_transaction WHERE occ_id IS NOT NULL",
  );
  for (const row of r.rows) await recomputeFeature(pool, row.occ_id, now);
  return { count: r.rows.length };
}

/** Đọc feature đã tính (null nếu chưa có). */
export async function getFeature(pool: Pool, occId: string): Promise<CustomerFeature | null> {
  const r = await pool.query(
    `SELECT occ_id, recency_days, frequency, monetary, avg_basket, distinct_brands,
            distinct_categories, favorite_category, loyalty_available, last_order_at,
            lifecycle_stage, propensity_score, churn_risk, feature_version, computed_at
       FROM cdp.customer_feature WHERE occ_id=$1`,
    [occId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    occId: row.occ_id, recencyDays: row.recency_days, frequency: Number(row.frequency),
    monetary: Number(row.monetary), avgBasket: Number(row.avg_basket),
    distinctBrands: Number(row.distinct_brands), distinctCategories: Number(row.distinct_categories),
    favoriteCategory: row.favorite_category, loyaltyAvailable: Number(row.loyalty_available),
    lastOrderAt: row.last_order_at, lifecycleStage: row.lifecycle_stage,
    propensityScore: row.propensity_score === null ? null : Number(row.propensity_score),
    churnRisk: row.churn_risk === null ? null : Number(row.churn_risk),
    featureVersion: row.feature_version, computedAt: row.computed_at,
  };
}
