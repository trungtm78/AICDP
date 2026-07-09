import type { Pool } from "pg";
import { z } from "zod";
import { runLlmTask } from "./llm.gateway.js";
import { AppError } from "../http/errors.js";

// NL Analytics "hỏi dữ liệu" AN TOÀN: LLM chỉ sinh JSON PLAN (metric/dimension/filter), KHÔNG
// sinh SQL tự do. Service build SELECT THAM SỐ HOÁ từ mảnh SQL WHITELIST theo enum đã validate.
// Không nội suy chuỗi người dùng vào SQL. Chỉ đọc (SELECT) trên bảng/view whitelist.

export const nlqPlanSchema = z.object({
  metric: z.enum(["revenue", "orders", "customers", "avg_order"]),
  dimension: z.enum(["brand", "month", "lifecycle", "none"]).optional(),
  timeRangeDays: z.number().int().positive().max(3650).optional(),
  limit: z.number().int().positive().max(50).optional(),
});
export type NlqPlan = z.infer<typeof nlqPlanSchema>;

const METRIC_SQL: Record<NlqPlan["metric"], { expr: string; label: string }> = {
  revenue: { expr: "COALESCE(sum(ct.total),0)::bigint", label: "Doanh thu" },
  orders: { expr: "count(*)::bigint", label: "Số đơn" },
  customers: { expr: "count(DISTINCT ct.occ_id)::bigint", label: "Số khách" },
  avg_order: { expr: "COALESCE(avg(ct.total),0)::bigint", label: "Giá trị đơn TB" },
};

const DIM_SQL: Record<Exclude<NlqPlan["dimension"], undefined | "none">, { expr: string; join: string; label: string }> = {
  brand: { expr: "ct.brand_id", join: "", label: "Thương hiệu" },
  month: { expr: "to_char(date_trunc('month', ct.occ_timestamp), 'YYYY-MM')", join: "", label: "Tháng" },
  lifecycle: { expr: "cf.lifecycle_stage", join: "LEFT JOIN cdp.customer_feature cf ON cf.occ_id = ct.occ_id", label: "Vòng đời" },
};

export interface NlqResult {
  plan: NlqPlan;
  columns: string[];
  rows: { label: string; value: number }[];
  chartType: "bar" | "line" | "single";
  sql: string;
}

/** Chạy plan đã validate -> SELECT tham số hoá whitelist. */
export async function runNlqPlan(pool: Pool, plan: NlqPlan): Promise<NlqResult> {
  const metric = METRIC_SQL[plan.metric];
  const params: unknown[] = [];
  let where = "1=1";
  if (plan.timeRangeDays !== undefined) {
    params.push(plan.timeRangeDays);
    where = `ct.occ_timestamp >= now() - ($${params.length} || ' days')::interval`;
  }

  const dim = plan.dimension && plan.dimension !== "none" ? DIM_SQL[plan.dimension] : null;
  let sql: string;
  if (dim) {
    params.push(Math.min(plan.limit ?? 12, 50));
    sql = `SELECT ${dim.expr} AS label, ${metric.expr} AS value
             FROM cdp.canonical_transaction ct ${dim.join}
            WHERE ${where}
            GROUP BY 1 ORDER BY value DESC NULLS LAST LIMIT $${params.length}`;
  } else {
    sql = `SELECT '${metric.label}' AS label, ${metric.expr} AS value
             FROM cdp.canonical_transaction ct WHERE ${where}`;
  }

  const r = await pool.query<{ label: string | null; value: string }>(sql, params);
  const rows = r.rows.map((x) => ({ label: x.label ?? "—", value: Number(x.value) }));
  return {
    plan, columns: [dim?.label ?? "Chỉ số", metric.label], rows,
    chartType: dim ? (plan.dimension === "month" ? "line" : "bar") : "single", sql,
  };
}

/** NL question -> plan (LLM) -> validate -> run. LLM chưa cấu hình -> lỗi rõ ràng. */
export async function askData(pool: Pool, question: string, principalId?: string): Promise<NlqResult & { answered: string }> {
  const r = await runLlmTask(pool, "ask", {
    system:
      "Chuyển câu hỏi phân tích (tiếng Việt) thành JSON PLAN. CHỈ trả JSON, không markdown. " +
      "Field: metric(revenue|orders|customers|avg_order), dimension(brand|month|lifecycle|none), " +
      "timeRangeDays(int, ví dụ 30/90/365), limit(int<=50). Chọn dimension='month' nếu hỏi xu hướng theo thời gian, " +
      "'brand' nếu theo thương hiệu, 'lifecycle' nếu theo vòng đời, 'none' nếu tổng.",
    user: question,
    maxTokens: 200,
    ...(principalId !== undefined ? { principalId } : {}),
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1));
  } catch {
    throw new AppError({ code: "SCHEMA_TYPE_MISMATCH", httpStatus: 422, message: "Không hiểu câu hỏi thành truy vấn", why: "LLM không trả JSON plan hợp lệ.", fix: "Hỏi rõ hơn, ví dụ 'doanh thu theo thương hiệu 90 ngày qua'." });
  }
  const plan = nlqPlanSchema.parse(parsed);
  const result = await runNlqPlan(pool, plan);
  const answered = `${result.columns[1]}${plan.dimension && plan.dimension !== "none" ? ` theo ${result.columns[0]}` : ""}${plan.timeRangeDays ? ` (${plan.timeRangeDays} ngày qua)` : ""}`;
  return { ...result, answered };
}
