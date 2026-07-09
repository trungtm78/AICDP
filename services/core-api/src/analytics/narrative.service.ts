import type { Pool } from "pg";
import { runLlmTask } from "../llm/llm.gateway.js";
import { AppError } from "../http/errors.js";
import { detectAnomalies } from "./anomaly.service.js";

// Auto-narrative: dựng FACTS tổng hợp (phi-PII) từ doanh thu brand + vòng đời + bất thường,
// rồi nhờ LLM diễn giải 2-3 câu tiếng Việt. LLM chưa cấu hình -> fallback template (vẫn chạy).

interface Facts {
  topBrand: { brand: string; revenue: number } | null;
  weekRevenue: number;
  prevWeekRevenue: number;
  deltaPct: number;
  lifecycleTop: { stage: string; count: number } | null;
  anomalies: { metric: string; direction: string; zscore: number }[];
}

async function buildFacts(pool: Pool): Promise<Facts> {
  const brand = await pool.query<{ brand_id: string; revenue: string }>(
    `SELECT brand_id, COALESCE(sum(total),0)::bigint AS revenue
       FROM cdp.canonical_transaction WHERE occ_timestamp >= now() - interval '1 week'
       GROUP BY 1 ORDER BY revenue DESC LIMIT 1`,
  );
  const wk = await pool.query<{ cur: string; prev: string }>(
    `SELECT
       COALESCE(sum(total) FILTER (WHERE occ_timestamp >= now() - interval '1 week'),0)::bigint AS cur,
       COALESCE(sum(total) FILTER (WHERE occ_timestamp >= now() - interval '2 week'
                                     AND occ_timestamp < now() - interval '1 week'),0)::bigint AS prev
       FROM cdp.canonical_transaction`,
  );
  const life = await pool.query<{ stage: string; count: string }>(
    `SELECT lifecycle_stage AS stage, count(*)::int AS count FROM cdp.customer_feature
       WHERE lifecycle_stage IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 1`,
  );
  const anomalies = await detectAnomalies(pool);
  const cur = Number(wk.rows[0]?.cur ?? 0);
  const prev = Number(wk.rows[0]?.prev ?? 0);
  return {
    topBrand: brand.rows[0] ? { brand: brand.rows[0].brand_id, revenue: Number(brand.rows[0].revenue) } : null,
    weekRevenue: cur, prevWeekRevenue: prev,
    deltaPct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0,
    lifecycleTop: life.rows[0] ? { stage: life.rows[0].stage, count: Number(life.rows[0].count) } : null,
    anomalies: anomalies.slice(0, 3).map((a) => ({ metric: a.metric, direction: a.direction, zscore: a.zscore })),
  };
}

function fallbackNarrative(f: Facts): string {
  const parts: string[] = [];
  const dir = f.deltaPct >= 0 ? "tăng" : "giảm";
  parts.push(`Doanh thu 7 ngày qua ${dir} ${Math.abs(f.deltaPct)}% so với tuần trước.`);
  if (f.topBrand) parts.push(`Thương hiệu dẫn đầu tuần: ${f.topBrand.brand}.`);
  if (f.lifecycleTop) parts.push(`Nhóm vòng đời đông nhất: ${f.lifecycleTop.stage} (${f.lifecycleTop.count} khách).`);
  if (f.anomalies.length > 0) parts.push(`Phát hiện ${f.anomalies.length} bất thường thống kê cần chú ý.`);
  return parts.join(" ");
}

export interface Narrative { text: string; source: "llm" | "fallback"; facts: Facts }

/** Sinh narrative (LLM nếu cấu hình, else template). Trả kèm facts để UI hiển thị/kiểm chứng. */
export async function generateNarrative(pool: Pool, principalId?: string): Promise<Narrative> {
  const facts = await buildFacts(pool);
  try {
    const r = await runLlmTask(pool, "ask", {
      system: "Bạn là nhà phân tích CDP. Viết 2-3 câu tiếng Việt tóm tắt tình hình từ SỐ LIỆU TỔNG HỢP (phi danh tính) bên dưới. Nêu con số cụ thể, nêu nguyên nhân nếu suy được, KHÔNG bịa. KHÔNG markdown.",
      user: `Số liệu: ${JSON.stringify(facts)}`,
      maxTokens: 300,
      ...(principalId !== undefined ? { principalId } : {}),
    });
    return { text: r.text.trim(), source: "llm", facts };
  } catch (err) {
    if (err instanceof AppError && (err.code === "LLM_NOT_CONFIGURED" || err.code === "LLM_DISABLED")) {
      return { text: fallbackNarrative(facts), source: "fallback", facts };
    }
    throw err;
  }
}
