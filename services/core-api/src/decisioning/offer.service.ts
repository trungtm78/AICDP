import type { Pool } from "pg";
import { isAllowed } from "../consent/consent.service.js";

// Offer catalog + arbitration ML-scored. expectedValue = propensity(dự đoán) × base_value ×
// consentOk. Chọn offer có expectedValue cao nhất (đủ điều kiện). Consent gate CHỈ ở kênh
// marketing (offer cần purpose). Giữ tinh thần NbaDecision — thêm candidates[] để minh bạch.

export interface Offer {
  id: string;
  name: string;
  kind: "loyalty_bonus" | "discount" | "content" | "activation";
  purpose: string | null;
  channel: string | null;
  baseValue: number;
  eligibility: string | null;
  status: "active" | "paused";
  createdAt: string;
}

interface OfferRow {
  id: string; name: string; kind: Offer["kind"]; purpose: string | null; channel: string | null;
  base_value: string; eligibility: string | null; status: Offer["status"]; created_at: string;
}
const mapOffer = (r: OfferRow): Offer => ({
  id: r.id, name: r.name, kind: r.kind, purpose: r.purpose, channel: r.channel,
  baseValue: Number(r.base_value), eligibility: r.eligibility, status: r.status, createdAt: r.created_at,
});

export async function listOffers(pool: Pool): Promise<Offer[]> {
  const r = await pool.query<OfferRow>("SELECT * FROM cdp.offer_catalog ORDER BY created_at DESC");
  return r.rows.map(mapOffer);
}

export async function createOffer(
  pool: Pool,
  a: { name: string; kind: Offer["kind"]; purpose?: string | null | undefined; channel?: string | null | undefined; baseValue: number; eligibility?: string | null | undefined },
): Promise<Offer> {
  const r = await pool.query<OfferRow>(
    `INSERT INTO cdp.offer_catalog (name, kind, purpose, channel, base_value, eligibility)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [a.name, a.kind, a.purpose ?? null, a.channel ?? null, a.baseValue, a.eligibility ?? null],
  );
  return mapOffer(r.rows[0]!);
}

export async function deleteOffer(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM cdp.offer_catalog WHERE id=$1", [id]);
  return (r.rowCount ?? 0) > 0;
}

export interface OfferCandidate {
  offerId: string;
  name: string;
  kind: string;
  baseValue: number;
  propensity: number;
  consentOk: boolean;
  expectedValue: number;
  eligible: boolean;
  reason: string;
}

export interface ArbitrationResult {
  occId: string;
  winner: OfferCandidate | null;
  candidates: OfferCandidate[];
  lifecycleStage: string | null;
}

/** Arbitration: chấm điểm mọi offer active cho 1 khách, chọn expectedValue cao nhất (đủ ĐK). */
export async function arbitrate(pool: Pool, occId: string): Promise<ArbitrationResult> {
  const offers = (await listOffers(pool)).filter((o) => o.status === "active");
  const pred = await pool.query<{ propensity: string | null }>(
    "SELECT propensity FROM cdp.customer_prediction WHERE occ_id=$1", [occId],
  );
  const propensity = pred.rows[0]?.propensity != null ? Number(pred.rows[0].propensity) : 0.3;
  const feat = await pool.query<{ lifecycle_stage: string | null }>(
    "SELECT lifecycle_stage FROM cdp.customer_feature WHERE occ_id=$1", [occId],
  );
  const stage = feat.rows[0]?.lifecycle_stage ?? null;

  const candidates: OfferCandidate[] = [];
  for (const o of offers) {
    let consentOk = true;
    if (o.purpose) consentOk = await isAllowed(pool, occId, o.purpose);
    const eligByStage = !o.eligibility || o.eligibility === stage;
    const eligible = consentOk && eligByStage;
    const expectedValue = eligible ? Math.round(propensity * o.baseValue) : 0;
    candidates.push({
      offerId: o.id, name: o.name, kind: o.kind, baseValue: o.baseValue,
      propensity: Math.round(propensity * 1000) / 1000, consentOk, expectedValue, eligible,
      reason: !eligByStage ? `chỉ cho ${o.eligibility}` : !consentOk ? `thiếu consent ${o.purpose}` : `EV = propensity×giá trị`,
    });
  }
  candidates.sort((a, b) => b.expectedValue - a.expectedValue);
  const winner = candidates.find((c) => c.eligible && c.expectedValue > 0) ?? null;
  return { occId, winner, candidates, lifecycleStage: stage };
}
