import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { getConfig } from "../ai-config/ai-config.service.js";
import { recommendV2, type RecommendationV2 } from "../ai/ai.service.js";

// Real-time Personalization: Profile API + Recommendation API độ trễ thấp. Cache-aside Redis
// (TTL) với FALLBACK Postgres khi Redis miss/down — core-api luôn phục vụ. Reco precomputed
// (recommendV2) là THẬT; cache là tối ưu độ trễ. Honest-label nguồn cache/db.

const PROFILE_TTL = 3600; // 1h
const RECO_TTL = 1800;    // 30m

export interface RtProfile {
  occId: string;
  fullName: string | null;
  lifecycleStage: string | null;
  monetary: number;
  loyaltyAvailable: number;
  churnProb: number | null;
  propensity: number | null;
  predictedClv: number | null;
}

export interface RtResult<T> { data: T; cacheHit: boolean }

async function redisGet(redis: Redis, key: string): Promise<string | null> {
  try { return await redis.get(key); } catch { return null; }
}
async function redisSet(redis: Redis, key: string, val: string, ttl: number): Promise<void> {
  try { await redis.set(key, val, "EX", ttl); } catch { /* Redis down -> bỏ qua, vẫn trả từ PG */ }
}

async function buildProfile(pool: Pool, occId: string): Promise<RtProfile | null> {
  const r = await pool.query<{
    full_name: string | null; lifecycle_stage: string | null; monetary: string; loyalty_available: string;
    churn_prob: string | null; propensity: string | null; predicted_clv: string | null;
  }>(
    `SELECT p.full_name, cf.lifecycle_stage, cf.monetary, cf.loyalty_available,
            cp.churn_prob, cp.propensity, cp.predicted_clv
       FROM cdp.customer_feature cf
       LEFT JOIN cdp.profile p ON p.occ_id = cf.occ_id
       LEFT JOIN cdp.customer_prediction cp ON cp.occ_id = cf.occ_id
      WHERE cf.occ_id = $1`,
    [occId],
  );
  const row = r.rows[0];
  if (!row) return null;
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    occId, fullName: row.full_name, lifecycleStage: row.lifecycle_stage,
    monetary: Number(row.monetary), loyaltyAvailable: Number(row.loyalty_available),
    churnProb: num(row.churn_prob), propensity: num(row.propensity), predictedClv: num(row.predicted_clv),
  };
}

/** Profile API độ trễ thấp: Redis cache-aside, fallback PG. */
export async function getProfile(pool: Pool, redis: Redis, occId: string): Promise<RtResult<RtProfile | null>> {
  const key = `profile:${occId}`;
  const cached = await redisGet(redis, key);
  if (cached) return { data: JSON.parse(cached) as RtProfile, cacheHit: true };
  const data = await buildProfile(pool, occId);
  if (data) await redisSet(redis, key, JSON.stringify(data), PROFILE_TTL);
  return { data, cacheHit: false };
}

/** Recommendation API độ trễ thấp: Redis cache-aside, fallback recommendV2 (PG). */
export async function getReco(pool: Pool, redis: Redis, occId: string): Promise<RtResult<RecommendationV2[]>> {
  const key = `reco:${occId}`;
  const cached = await redisGet(redis, key);
  if (cached) return { data: JSON.parse(cached) as RecommendationV2[], cacheHit: true };
  const cfg = await getConfig(pool);
  const data = await recommendV2(pool, occId, cfg.reco);
  await redisSet(redis, key, JSON.stringify(data), RECO_TTL);
  return { data, cacheHit: false };
}

/** Warmer: precompute + nạp cache cho toàn bộ khách (hoặc N khách). Trả số đã nạp. */
export async function warmAll(pool: Pool, redis: Redis, limit = 500): Promise<{ warmed: number; redisUp: boolean }> {
  let redisUp = true;
  try { await redis.ping(); } catch { redisUp = false; }
  if (!redisUp) return { warmed: 0, redisUp: false };
  const ids = await pool.query<{ occ_id: string }>(
    "SELECT occ_id::text FROM cdp.customer_feature ORDER BY monetary DESC LIMIT $1", [limit],
  );
  const cfg = await getConfig(pool);
  let warmed = 0;
  for (const row of ids.rows) {
    const profile = await buildProfile(pool, row.occ_id);
    if (profile) await redisSet(redis, `profile:${row.occ_id}`, JSON.stringify(profile), PROFILE_TTL);
    const reco = await recommendV2(pool, row.occ_id, cfg.reco);
    await redisSet(redis, `reco:${row.occ_id}`, JSON.stringify(reco), RECO_TTL);
    warmed++;
  }
  return { warmed, redisUp: true };
}

export async function redisStatus(redis: Redis): Promise<{ up: boolean; keys: number }> {
  try {
    await redis.ping();
    const dbsize = await redis.dbsize();
    return { up: true, keys: dbsize };
  } catch {
    return { up: false, keys: 0 };
  }
}
