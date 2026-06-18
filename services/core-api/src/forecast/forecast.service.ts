import type { Pool } from "pg";

// Forecast doanh số / nhu cầu — HEURISTIC v0 (moving-average + linear trend) trên
// canonical_transaction. method='heuristic-ma'. Phase C thay bằng time-series ML
// (Prophet/GBDT) ở ai-service — GIỮ NGUYÊN signature/ForecastResult.

export type Granularity = "week" | "month";

export interface ForecastPoint {
  period: string; // ISO date (đầu kỳ)
  revenue: number;
  transactions: number;
}

export interface ForecastFuturePoint {
  period: string;
  revenue: number;
}

export interface ForecastResult {
  brandId: string | null;
  storeId: string | null;
  granularity: Granularity;
  history: ForecastPoint[];
  forecast: ForecastFuturePoint[];
  method: "heuristic-ma";
}

export interface ForecastArgs {
  brandId?: string | undefined;
  storeId?: string | undefined;
  granularity?: Granularity | undefined;
  periods?: number | undefined; // số kỳ dự báo
  window?: number | undefined; // độ rộng moving-average
}

function addPeriod(d: Date, g: Granularity, n: number): Date {
  const r = new Date(d.getTime());
  if (g === "week") r.setUTCDate(r.getUTCDate() + 7 * n);
  else r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/** Least-squares slope của chuỗi y theo index 0..n-1 (0 nếu < 2 điểm). */
function linregSlope(y: number[]): number {
  const n = y.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (y[i]! - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

export async function forecastRevenue(pool: Pool, args: ForecastArgs = {}): Promise<ForecastResult> {
  const granularity: Granularity = args.granularity ?? "week";
  const periods = Math.max(1, args.periods ?? 4);
  const window = Math.max(1, args.window ?? 4);

  const where: string[] = ["occ_timestamp IS NOT NULL"];
  const params: unknown[] = [granularity];
  if (args.brandId !== undefined) {
    params.push(args.brandId);
    where.push(`brand_id = $${params.length}`);
  }
  if (args.storeId !== undefined) {
    params.push(args.storeId);
    where.push(`store_id = $${params.length}`);
  }

  const r = await pool.query<{ period: string; revenue: string; transactions: string }>(
    `SELECT date_trunc($1, occ_timestamp)::date::text AS period,
            sum(total)::bigint  AS revenue,
            count(*)::int       AS transactions
       FROM cdp.canonical_transaction
      WHERE ${where.join(" AND ")}
      GROUP BY 1 ORDER BY 1`,
    params,
  );

  const history: ForecastPoint[] = r.rows.map((row) => ({
    period: row.period,
    revenue: Number(row.revenue),
    transactions: Number(row.transactions),
  }));

  const forecast: ForecastFuturePoint[] = [];
  if (history.length > 0) {
    const revs = history.map((h) => h.revenue);
    const slope = linregSlope(revs);
    const lastWindow = revs.slice(-window);
    const baseline = lastWindow.reduce((a, b) => a + b, 0) / lastWindow.length;
    const lastDate = new Date(history[history.length - 1]!.period);
    for (let i = 1; i <= periods; i++) {
      const value = Math.max(0, Math.round(baseline + slope * i));
      forecast.push({ period: addPeriod(lastDate, granularity, i).toISOString().slice(0, 10), revenue: value });
    }
  }

  return {
    brandId: args.brandId ?? null,
    storeId: args.storeId ?? null,
    granularity,
    history,
    forecast,
    method: "heuristic-ma",
  };
}
