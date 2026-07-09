import type { Pool } from "pg";
import { runLlmTask } from "./llm.gateway.js";
import { getFeature, recomputeFeature } from "../feature/feature.service.js";
import { getConfig } from "../ai-config/ai-config.service.js";
import { previewSegment, type SegmentCriteria, type SegmentPreview } from "../segment/segment.service.js";
import { validate } from "../http/validate.js";
import { segmentPreviewSchema } from "../http/schemas.js";
import { AppError } from "../http/errors.js";

// Generative AI assistant (LLM). 4 tính năng: NLQ (ask), NL->segment, sinh nội dung, diễn giải
// điểm số. ⚠️ GUARDRAIL PII: KHÔNG truyền tên/sđt/email khách vào prompt — chỉ số liệu tổng hợp,
// lifecycle/score, category. (occId là uuid ẩn danh, không phải PII trực tiếp.)

/** Diễn giải điểm số/insight của 1 khách thành văn bản tiếng Việt cho CSR/marketer. */
export async function explainCustomer(pool: Pool, occId: string, principalId?: string): Promise<{ text: string }> {
  const f = (await getFeature(pool, occId)) ?? (await recomputeFeature(pool, occId));
  // Chỉ gửi số liệu phi-PII.
  const facts = {
    lifecycle: f.lifecycleStage,
    recencyDays: f.recencyDays,
    frequency: f.frequency,
    monetary: f.monetary,
    distinctBrands: f.distinctBrands,
    favoriteCategory: f.favoriteCategory,
    propensity: f.propensityScore,
    churnRisk: f.churnRisk,
  };
  const r = await runLlmTask(pool, "explain", {
    system:
      "Bạn là trợ lý CDP. Diễn giải hồ sơ hành vi khách hàng (RFM/lifecycle) thành 2-3 câu tiếng Việt súc tích cho nhân viên marketing, kèm 1 gợi ý hành động. KHÔNG bịa số liệu ngoài dữ liệu cho sẵn.",
    user: `Dữ liệu khách (phi danh tính): ${JSON.stringify(facts)}`,
    maxTokens: 400,
    ...(principalId !== undefined ? { principalId } : {}),
  });
  return { text: r.text };
}

/** Sinh segment từ mô tả ngôn ngữ tự nhiên -> SegmentCriteria (validate) -> preview. */
export async function nlToSegment(
  pool: Pool,
  description: string,
  principalId?: string,
): Promise<{ criteria: SegmentCriteria; preview: SegmentPreview }> {
  const r = await runLlmTask(pool, "segment", {
    system:
      "Bạn chuyển mô tả đối tượng khách hàng (tiếng Việt) thành JSON SegmentCriteria. CHỈ trả JSON, " +
      "không markdown. Field cho phép: brandId(string), minSpend(int VND), minTransactions(int), " +
      "maxRecencyDays(int), lifecycleStage(new|active|at_risk|vip|dormant|churned), loyaltyMin(int), " +
      "categoryAffinity(string), consentPurpose(marketing_email|marketing_sms|marketing_zalo|personalization|data_sharing), " +
      "churnProbGte(0..1 nguy cơ rời), propensityGte(0..1 khả năng mua), clvMin(int VND giá trị vòng đời dự đoán). " +
      "Bỏ field không liên quan.",
    user: description,
    maxTokens: 400,
    ...(principalId !== undefined ? { principalId } : {}),
  });
  let parsed: unknown;
  try {
    const jsonStr = r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1);
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new AppError({ code: "SCHEMA_TYPE_MISMATCH", httpStatus: 422, message: "LLM không trả JSON segment hợp lệ", why: "Không parse được output LLM.", fix: "Diễn đạt lại mô tả segment rõ ràng hơn." });
  }
  const criteria = validate(segmentPreviewSchema, parsed, "ai_nl_segment") as SegmentCriteria;
  const preview = await previewSegment(pool, criteria);
  return { criteria, preview };
}

/** Sinh nội dung marketing theo brief + brand voice. (Consent-aware ở bước activation, không ở đây.) */
export async function generateContent(
  pool: Pool,
  args: { brief: string; brandVoice?: string; channel?: string },
  principalId?: string,
): Promise<{ text: string }> {
  const r = await runLlmTask(pool, "content", {
    system: `Bạn là copywriter cho CDP F&B đa thương hiệu OCC. Viết nội dung marketing tiếng Việt ngắn gọn theo brand voice${args.brandVoice ? ` (${args.brandVoice})` : ""}${args.channel ? `, kênh ${args.channel}` : ""}. Dùng token cá nhân hóa dạng {{ten_khach}} nếu cần, KHÔNG bịa thông tin khách cụ thể.`,
    user: args.brief,
    maxTokens: 600,
    ...(principalId !== undefined ? { principalId } : {}),
  });
  return { text: r.text };
}

/** NLQ: hỏi dữ liệu tổng quan bằng tiếng Việt. Context = số liệu tổng hợp phi-PII. */
export async function askAssistant(pool: Pool, question: string, principalId?: string): Promise<{ text: string }> {
  const agg = await pool.query<{ customers: string; txns: string; revenue: string }>(
    `SELECT (SELECT count(*) FROM cdp.occ_identity)::text AS customers,
            (SELECT count(*) FROM cdp.canonical_transaction)::text AS txns,
            (SELECT COALESCE(sum(total),0) FROM cdp.canonical_transaction)::text AS revenue`,
  );
  const ctx = agg.rows[0]!;
  // Đảm bảo dùng config (kích hoạt fail-fast nếu assistant tắt) trước khi gọi.
  await getConfig(pool);
  const r = await runLlmTask(pool, "ask", {
    system:
      "Bạn là trợ lý phân tích CDP. Trả lời câu hỏi bằng tiếng Việt DỰA TRÊN số liệu tổng hợp cho sẵn. " +
      "Nếu thiếu dữ liệu để trả lời, nói rõ. KHÔNG bịa số.",
    user: `Số liệu hệ thống: khách=${ctx.customers}, giao dịch=${ctx.txns}, tổng doanh thu(VND)=${ctx.revenue}.\nCâu hỏi: ${question}`,
    maxTokens: 600,
    ...(principalId !== undefined ? { principalId } : {}),
  });
  return { text: r.text };
}
