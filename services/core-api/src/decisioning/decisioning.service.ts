import type { Pool } from "pg";
import { isAllowed } from "../consent/consent.service.js";
import { getFeature, recomputeFeature } from "../feature/feature.service.js";
import type { AiConfig } from "../ai-config/ai-config.service.js";

// Decisioning v0 — Next-Best-Action: kết hợp lifecycle (feature) + business rules + CONSENT GATE.
// Hành động cần kênh marketing phải qua isAllowed() (deny-by-default); denied -> fallback hành
// động không cần consent. Explainable (reasons + consentChecked). Phase C: thay rule bằng
// ML-scored arbitration — GIỮ NGUYÊN NbaDecision.

export type NbaAction =
  | { type: "loyalty_bonus"; points: number }
  | { type: "offer"; purpose: string; channel: string }
  | { type: "onboarding" }
  | { type: "recommendation" }
  | { type: "none" };

export interface NbaDecision {
  occId: string;
  action: NbaAction;
  eligible: boolean;
  reasons: string[];
  consentChecked: { purpose: string; allowed: boolean } | null;
  lifecycleStage: string | null;
}

const WINBACK_PURPOSE = "marketing_email";

export async function decideNBA(
  pool: Pool,
  occId: string,
  cfg: AiConfig,
): Promise<NbaDecision> {
  if (!cfg.decisioning.enabled) {
    return { occId, action: { type: "none" }, eligible: false, reasons: ["Decisioning đang tắt"], consentChecked: null, lifecycleStage: null };
  }

  const feature = (await getFeature(pool, occId)) ?? (await recomputeFeature(pool, occId));
  const stage = feature.lifecycleStage; // lifecycle: nguồn = customer_feature
  // churn/propensity: nguồn DUY NHẤT = customer_prediction (ml|heuristic) — nhất quán với
  // Predictions/Segment/Customer360; fallback feature.churnRisk nếu chưa có prediction row.
  const pred = await pool.query<{ churn_prob: string | null; propensity: string | null; score_source: string }>(
    "SELECT churn_prob, propensity, score_source FROM cdp.customer_prediction WHERE occ_id=$1",
    [occId],
  );
  const p = pred.rows[0];
  const churn = p?.churn_prob != null ? Number(p.churn_prob) : feature.churnRisk;
  const source = p ? p.score_source : "heuristic";
  const reasons: string[] = [`lifecycle=${stage ?? "?"}`, `churn=${churn ?? "?"} (${source})`];

  // VIP -> thưởng điểm giữ chân (không cần consent).
  if (stage === "vip") {
    reasons.push("VIP: thưởng điểm tri ân");
    return { occId, action: { type: "loyalty_bonus", points: 200 }, eligible: true, reasons, consentChecked: null, lifecycleStage: stage };
  }

  // Khách mới -> onboarding (in-app, không cần consent).
  if (stage === "new") {
    reasons.push("Khách mới: chuỗi onboarding");
    return { occId, action: { type: "onboarding" }, eligible: true, reasons, consentChecked: null, lifecycleStage: stage };
  }

  // Có nguy cơ rời / ngủ đông / đã rời -> win-back qua email NẾU có consent; nếu không -> thưởng điểm.
  if (stage === "at_risk" || stage === "dormant" || stage === "churned") {
    const allowed = await isAllowed(pool, occId, WINBACK_PURPOSE);
    if (allowed) {
      reasons.push("Win-back qua email (đã có consent)");
      return {
        occId, action: { type: "offer", purpose: WINBACK_PURPOSE, channel: "email" },
        eligible: true, reasons, consentChecked: { purpose: WINBACK_PURPOSE, allowed: true }, lifecycleStage: stage,
      };
    }
    reasons.push("Chưa consent email -> fallback thưởng điểm (không cần consent)");
    return {
      occId, action: { type: "loyalty_bonus", points: 100 },
      eligible: true, reasons, consentChecked: { purpose: WINBACK_PURPOSE, allowed: false }, lifecycleStage: stage,
    };
  }

  // Active -> gợi ý cross-sell (in-app, không cần consent).
  if (stage === "active") {
    reasons.push("Đang hoạt động: gợi ý cross-sell");
    return { occId, action: { type: "recommendation" }, eligible: true, reasons, consentChecked: null, lifecycleStage: stage };
  }

  reasons.push("Không có hành động phù hợp");
  return { occId, action: { type: "none" }, eligible: false, reasons, consentChecked: null, lifecycleStage: stage };
}
