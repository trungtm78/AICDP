import type { Pool } from "pg";
import { getInsights } from "../analytics/analytics.service.js";
import { nlToSegment, generateContent } from "./assistant.service.js";
import { AppError } from "../http/errors.js";

// Marketing Copilot (đa-bước, human-in-the-loop): điều phối LLM + service nội bộ theo chuỗi
// research → segment → content → đề xuất journey. TRẢ artifact từng bước để NGƯỜI DUYỆT; KHÔNG
// tự tạo/kích hoạt journey (chỉ đề xuất; tạo thật qua endpoint journey khi user xác nhận).

export interface CopilotStep {
  key: string;
  title: string;
  status: "ok" | "skipped" | "error";
  summary: string;
  artifact?: unknown;
}

export interface CopilotResult {
  brief: string;
  steps: CopilotStep[];
  proposedJourney: { name: string; segmentCriteria: Record<string, unknown>; action: string } | null;
}

/** Chạy copilot cho một brief marketing. Mỗi bước độc lập lỗi (skip) để chuỗi vẫn hoàn tất. */
export async function runCopilot(pool: Pool, brief: string, principalId?: string): Promise<CopilotResult> {
  const steps: CopilotStep[] = [];

  // 1) Research — tổng hợp tình hình (không LLM).
  let insights: Awaited<ReturnType<typeof getInsights>> | null = null;
  try {
    insights = await getInsights(pool);
    const topBrand = insights.revenueByBrand[0];
    steps.push({
      key: "research", title: "Nghiên cứu dữ liệu", status: "ok",
      summary: `${insights.totalWithFeature} khách đã phân tích, ${insights.crossBrandCustomers} mua đa thương hiệu. Brand dẫn đầu: ${topBrand?.brandId ?? "?"}.`,
      artifact: { lifecycle: insights.lifecycle, revenueByBrand: insights.revenueByBrand.slice(0, 5), crossBrand: insights.crossBrandCustomers },
    });
  } catch (e) {
    steps.push({ key: "research", title: "Nghiên cứu dữ liệu", status: "error", summary: (e as Error).message });
  }

  // 2) Segment — NL → tiêu chí + preview (LLM).
  let segmentCriteria: Record<string, unknown> = {};
  try {
    const seg = await nlToSegment(pool, brief, principalId);
    segmentCriteria = seg.criteria as unknown as Record<string, unknown>;
    steps.push({
      key: "segment", title: "Dựng phân khúc", status: "ok",
      summary: `Phân khúc khớp ${seg.preview.count} khách.`,
      artifact: { criteria: seg.criteria, count: seg.preview.count },
    });
  } catch (e) {
    steps.push({ key: "segment", title: "Dựng phân khúc", status: skipOrError(e), summary: msg(e) });
  }

  // 3) Content — sinh nội dung marketing (LLM).
  try {
    const c = await generateContent(pool, { brief }, principalId);
    steps.push({ key: "content", title: "Sinh nội dung", status: "ok", summary: c.text.slice(0, 120), artifact: { text: c.text } });
  } catch (e) {
    steps.push({ key: "content", title: "Sinh nội dung", status: skipOrError(e), summary: msg(e) });
  }

  // 4) Đề xuất journey (KHÔNG tạo — chờ người duyệt).
  const proposedJourney = {
    name: `Chiến dịch: ${brief.slice(0, 50)}`,
    segmentCriteria,
    action: "loyalty_bonus + activation (gate consent)",
  };
  steps.push({
    key: "journey", title: "Đề xuất journey", status: "ok",
    summary: "Đề xuất journey: entry theo phân khúc → chờ → thưởng điểm / gửi (gate consent). Cần bấm 'Tạo journey nháp' để tạo.",
    artifact: proposedJourney,
  });

  return { brief, steps, proposedJourney };
}

function skipOrError(e: unknown): "skipped" | "error" {
  if (e instanceof AppError && (e.code === "LLM_NOT_CONFIGURED" || e.code === "LLM_DISABLED")) return "skipped";
  return "error";
}
function msg(e: unknown): string {
  if (e instanceof AppError) return `${e.code}: ${e.message}`;
  return (e as Error).message;
}
