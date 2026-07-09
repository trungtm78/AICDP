import type { Pool } from "pg";

// Anomaly detection (thống kê, KHÔNG ML): chuỗi tuần cho doanh thu/đơn/khách mới; z-score so
// với trung bình + độ lệch chuẩn rolling. |z|>=2 -> cảnh báo (warning), |z|>=3 -> critical.
// Kết quả upsert cdp.analytics_alert (dedupe metric+period) để hiển thị + acknowledge.

export interface Anomaly {
  metric: string;
  period: string;
  value: number;
  expected: number;
  zscore: number;
  severity: "info" | "warning" | "critical";
  direction: "up" | "down";
}

export interface SeriesPoint { period: string; value: number }

const METRICS: { key: string; label: string; sql: string }[] = [
  {
    key: "revenue_weekly", label: "Doanh thu theo tuần",
    sql: `SELECT to_char(date_trunc('week', occ_timestamp), 'IYYY-"W"IW') AS period,
                 COALESCE(sum(total),0)::float8 AS value
            FROM cdp.canonical_transaction
           WHERE occ_timestamp >= now() - interval '16 weeks'
           GROUP BY 1 ORDER BY 1`,
  },
  {
    key: "orders_weekly", label: "Số đơn theo tuần",
    sql: `SELECT to_char(date_trunc('week', occ_timestamp), 'IYYY-"W"IW') AS period,
                 count(*)::float8 AS value
            FROM cdp.canonical_transaction
           WHERE occ_timestamp >= now() - interval '16 weeks'
           GROUP BY 1 ORDER BY 1`,
  },
  {
    key: "new_customers_weekly", label: "Khách mới theo tuần",
    sql: `SELECT to_char(date_trunc('week', created_at), 'IYYY-"W"IW') AS period,
                 count(*)::float8 AS value
            FROM cdp.occ_identity
           WHERE created_at >= now() - interval '16 weeks'
           GROUP BY 1 ORDER BY 1`,
  },
];

function detect(metric: string, series: SeriesPoint[]): Anomaly[] {
  if (series.length < 4) return [];
  // Bỏ kỳ cuối (có thể chưa trọn tuần) khỏi baseline nhưng vẫn chấm nó.
  const values = series.map((s) => s.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const std = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length) || 1;
  const out: Anomaly[] = [];
  for (const p of series) {
    const z = (p.value - mean) / std;
    const az = Math.abs(z);
    if (az >= 2) {
      out.push({
        metric, period: p.period, value: Math.round(p.value), expected: Math.round(mean),
        zscore: Math.round(z * 100) / 100,
        severity: az >= 3 ? "critical" : "warning",
        direction: z >= 0 ? "up" : "down",
      });
    }
  }
  return out;
}

/** Chạy phát hiện bất thường trên các metric, upsert vào analytics_alert, trả danh sách. */
export async function detectAnomalies(pool: Pool): Promise<Anomaly[]> {
  const all: Anomaly[] = [];
  for (const m of METRICS) {
    const r = await pool.query<{ period: string; value: string }>(m.sql);
    const series = r.rows.map((x) => ({ period: x.period, value: Number(x.value) }));
    all.push(...detect(m.key, series));
  }
  for (const a of all) {
    await pool.query(
      `INSERT INTO cdp.analytics_alert (metric, period, value, expected, zscore, severity, direction)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (metric, period) DO UPDATE SET
         value=EXCLUDED.value, expected=EXCLUDED.expected, zscore=EXCLUDED.zscore,
         severity=EXCLUDED.severity, direction=EXCLUDED.direction`,
      [a.metric, a.period, a.value, a.expected, a.zscore, a.severity, a.direction],
    );
  }
  return all;
}

export interface AlertRow extends Anomaly { id: string; acknowledged: boolean; createdAt: string }

/** Danh sách cảnh báo đã lưu (mới nhất trước). */
export async function listAlerts(pool: Pool, limit = 50): Promise<AlertRow[]> {
  const r = await pool.query<{
    id: string; metric: string; period: string; value: string; expected: string;
    zscore: string; severity: Anomaly["severity"]; direction: "up" | "down";
    acknowledged: boolean; created_at: string;
  }>(
    `SELECT id::text, metric, period, value, expected, zscore, severity, direction, acknowledged, created_at
       FROM cdp.analytics_alert ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return r.rows.map((x) => ({
    id: x.id, metric: x.metric, period: x.period, value: Number(x.value), expected: Number(x.expected),
    zscore: Number(x.zscore), severity: x.severity, direction: x.direction,
    acknowledged: x.acknowledged, createdAt: x.created_at,
  }));
}

/** Chuỗi thời gian 1 metric (cho chart AnomalyLine) + đánh dấu điểm bất thường. */
export async function getMetricSeries(pool: Pool, metric: string): Promise<{ points: SeriesPoint[]; anomalies: Anomaly[] }> {
  const m = METRICS.find((x) => x.key === metric) ?? METRICS[0]!;
  const r = await pool.query<{ period: string; value: string }>(m.sql);
  const points = r.rows.map((x) => ({ period: x.period, value: Number(x.value) }));
  return { points, anomalies: detect(m.key, points) };
}

export async function acknowledgeAlert(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query("UPDATE cdp.analytics_alert SET acknowledged=true WHERE id=$1", [id]);
  return (r.rowCount ?? 0) > 0;
}
