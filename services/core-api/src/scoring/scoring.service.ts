import type { AiConfig } from "../ai-config/ai-config.service.js";

// Scoring v0 — HEURISTIC DETERMINISTIC (không ML, không DB). Phân lifecycle + propensity + churn
// từ RFM, đọc ngưỡng từ ai_config. reasons[] = explainable (vì sao). Phase C thay bằng ML
// (GBDT/survival) ghi feature_version='ml-v1' + SHAP vào reasons — GIỮ NGUYÊN ScoreResult.

export type LifecycleStage = "new" | "active" | "at_risk" | "vip" | "dormant" | "churned";

export interface RfmInput {
  recencyDays: number | null; // null = chưa có giao dịch
  frequency: number;
  monetary: number;
}

export interface ScoreResult {
  lifecycleStage: LifecycleStage;
  propensityScore: number; // 0..1
  churnRisk: number; // 0..1
  reasons: string[];
}

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

/**
 * Chấm điểm 1 khách từ RFM. Thứ tự ưu tiên lifecycle: new -> churned -> vip -> dormant ->
 * at_risk -> active. churnRisk tỉ lệ recency/churnGap; propensity cao khi gần đây + thường mua.
 */
export function scoreCustomer(input: RfmInput, cfg: AiConfig["rfm"]): ScoreResult {
  const { recencyDays, frequency, monetary } = input;
  const reasons: string[] = [];

  // churnRisk: chưa giao dịch -> 0 (không đủ tín hiệu); có recency -> tỉ lệ tới ngưỡng churn.
  const churnRisk =
    recencyDays === null ? 0 : round4(clamp01(recencyDays / cfg.churnGapDays));
  // propensity: gần đây (1-churnRisk) × mức thường xuyên (frequency/vipFreq).
  const freqRatio = cfg.vipFreq > 0 ? clamp01(frequency / cfg.vipFreq) : 0;
  const propensityScore = round4(clamp01((1 - churnRisk) * freqRatio));

  let lifecycleStage: LifecycleStage;
  if (frequency <= 1) {
    lifecycleStage = "new";
    reasons.push(`Khách mới: frequency ${frequency} ≤ 1`);
  } else if (recencyDays !== null && recencyDays >= cfg.churnGapDays) {
    lifecycleStage = "churned";
    reasons.push(`Đã rời: recency ${recencyDays} ngày ≥ ngưỡng churn ${cfg.churnGapDays}`);
  } else if (frequency >= cfg.vipFreq && monetary >= cfg.vipMonetary) {
    lifecycleStage = "vip";
    reasons.push(
      `VIP: frequency ${frequency} ≥ ${cfg.vipFreq} và chi tiêu ${monetary} ≥ ${cfg.vipMonetary}`,
    );
  } else if (recencyDays !== null && recencyDays >= cfg.dormantGapDays) {
    lifecycleStage = "dormant";
    reasons.push(`Ngủ đông: recency ${recencyDays} ngày ≥ ${cfg.dormantGapDays}`);
  } else if (recencyDays !== null && recencyDays >= cfg.atRiskGapDays) {
    lifecycleStage = "at_risk";
    reasons.push(`Có nguy cơ: recency ${recencyDays} ngày ≥ ${cfg.atRiskGapDays}`);
  } else {
    lifecycleStage = "active";
    reasons.push(`Đang hoạt động: recency ${recencyDays ?? "?"} ngày, frequency ${frequency}`);
  }

  reasons.push(`churnRisk=${churnRisk}, propensity=${propensityScore}`);
  return { lifecycleStage, propensityScore, churnRisk, reasons };
}
