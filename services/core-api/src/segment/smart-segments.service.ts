import type { Pool } from "pg";
import { previewSegment, type SegmentCriteria } from "./segment.service.js";

// Smart segments: preset tiêu chí gợi ý sẵn (dùng điểm dự đoán) — bấm để nạp vào segment builder.
// Demo-grade: gợi ý theo luật + ngưỡng dự đoán, không phải AutoML.

export interface SmartSegment {
  key: string;
  name: string;
  blurb: string;
  criteria: SegmentCriteria;
}

export const SMART_SEGMENTS: SmartSegment[] = [
  { key: "vip_at_risk", name: "VIP sắp rời", blurb: "Khách VIP có nguy cơ rời cao — ưu tiên giữ chân", criteria: { lifecycleStage: "vip", churnProbGte: 0.5 } },
  { key: "high_clv_dormant", name: "CLV cao đang ngủ", blurb: "Giá trị vòng đời cao nhưng lâu chưa mua", criteria: { clvMin: 10_000_000, maxRecencyDays: 120 } },
  { key: "high_propensity", name: "Sẵn sàng mua lại", blurb: "Khả năng mua 30 ngày tới cao — hợp cross-sell", criteria: { propensityGte: 0.5 } },
  { key: "churn_winback", name: "Nguy cơ rời — win-back", blurb: "Nguy cơ rời rất cao — cần chiến dịch win-back", criteria: { churnProbGte: 0.7 } },
  { key: "cross_brand", name: "Đa thương hiệu", blurb: "Đã mua ≥2 thương hiệu — tiềm năng loyalty hợp nhất", criteria: { minTransactions: 3 } },
];

/** Trả các preset + số khách preview (đếm nhanh qua previewSegment). */
export async function listSmartSegments(pool: Pool): Promise<(SmartSegment & { count: number })[]> {
  const out: (SmartSegment & { count: number })[] = [];
  for (const s of SMART_SEGMENTS) {
    const p = await previewSegment(pool, s.criteria);
    out.push({ ...s, count: p.count });
  }
  return out;
}
