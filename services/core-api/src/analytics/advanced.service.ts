import type { Pool } from "pg";

// Advanced Analytics (PG-only): RFM matrix, cohort/retention, attribution journey→doanh thu,
// conversion funnel. Tất cả đọc canonical_transaction + customer_feature + journey_participant.

// ── RFM matrix (R × F, ngũ phân vị) ──
export interface RfmMatrix {
  cells: [number, number, number][]; // [fIndex(0..4), rIndex(0..4), count]
  rLabels: string[]; // R (recency) hàng: R1 gần nhất
  fLabels: string[]; // F (frequency) cột
  total: number;
}

export async function rfmMatrix(pool: Pool): Promise<RfmMatrix> {
  const r = await pool.query<{ r_score: string; f_score: string; count: string }>(
    `WITH scored AS (
       SELECT ntile(5) OVER (ORDER BY recency_days ASC NULLS LAST) AS r_score,
              ntile(5) OVER (ORDER BY frequency ASC) AS f_score
         FROM cdp.customer_feature WHERE frequency > 0
     )
     SELECT r_score::text, f_score::text, count(*)::text FROM scored GROUP BY 1,2`,
  );
  const cells: [number, number, number][] = r.rows.map((x) => [Number(x.f_score) - 1, Number(x.r_score) - 1, Number(x.count)]);
  const total = cells.reduce((s, c) => s + c[2], 0);
  return {
    cells,
    rLabels: ["R1 (gần nhất)", "R2", "R3", "R4", "R5 (xa nhất)"],
    fLabels: ["F1 (ít)", "F2", "F3", "F4", "F5 (nhiều)"],
    total,
  };
}

// ── Cohort retention (cohort = tháng đầu mua, retention theo offset tháng) ──
export interface CohortRetention {
  cohorts: { cohort: string; size: number; retention: (number | null)[] }[]; // retention[offset] = tỉ lệ
  maxOffset: number;
}

export async function cohortRetention(pool: Pool, maxOffset = 6): Promise<CohortRetention> {
  const r = await pool.query<{ cohort: string; month_offset: string; active: string }>(
    `WITH firsts AS (
       SELECT occ_id, date_trunc('month', min(occ_timestamp)) AS cohort_month
         FROM cdp.canonical_transaction WHERE occ_id IS NOT NULL GROUP BY occ_id
     ),
     activity AS (
       SELECT f.cohort_month,
              (extract(year FROM ct.occ_timestamp)::int*12 + extract(month FROM ct.occ_timestamp)::int)
              - (extract(year FROM f.cohort_month)::int*12 + extract(month FROM f.cohort_month)::int) AS month_offset,
              ct.occ_id
         FROM cdp.canonical_transaction ct JOIN firsts f ON f.occ_id = ct.occ_id
     )
     SELECT to_char(cohort_month,'YYYY-MM') AS cohort, month_offset::text, count(DISTINCT occ_id)::text AS active
       FROM activity WHERE month_offset BETWEEN 0 AND $1
      GROUP BY cohort_month, month_offset ORDER BY cohort_month`,
    [maxOffset],
  );
  const byCohort = new Map<string, Map<number, number>>();
  for (const row of r.rows) {
    if (!byCohort.has(row.cohort)) byCohort.set(row.cohort, new Map());
    byCohort.get(row.cohort)!.set(Number(row.month_offset), Number(row.active));
  }
  const cohorts = [...byCohort.entries()].map(([cohort, m]) => {
    const size = m.get(0) ?? 0;
    const retention: (number | null)[] = [];
    for (let o = 0; o <= maxOffset; o++) {
      const a = m.get(o);
      retention.push(a === undefined ? null : size > 0 ? Math.round((a / size) * 1000) / 1000 : 0);
    }
    return { cohort, size, retention };
  });
  return { cohorts, maxOffset };
}

// ── Attribution journey → doanh thu (first/last/linear touch) ──
export type AttributionModel = "first" | "last" | "linear";
export interface Attribution {
  model: AttributionModel;
  journeys: { journeyId: string; name: string; conversions: number; attributedRevenue: number }[];
  totalRevenue: number;
}

export async function journeyAttribution(pool: Pool, model: AttributionModel): Promise<Attribution> {
  // Mỗi khách: các journey đã enroll (theo thời gian) + doanh thu SAU lần enroll đầu.
  const r = await pool.query<{ occ_id: string; journey_id: string; name: string; enrolled_at: string }>(
    `SELECT p.occ_id::text, p.journey_id::text, j.name, p.enrolled_at
       FROM cdp.journey_participant p JOIN cdp.journey j ON j.journey_id = p.journey_id
      ORDER BY p.occ_id, p.enrolled_at`,
  );
  // doanh thu sau enroll đầu tiên của mỗi khách
  const rev = await pool.query<{ occ_id: string; revenue: string }>(
    `WITH first_enroll AS (
       SELECT occ_id, min(enrolled_at) AS t0 FROM cdp.journey_participant GROUP BY occ_id
     )
     SELECT fe.occ_id::text, COALESCE(sum(ct.total),0)::text AS revenue
       FROM first_enroll fe
       JOIN cdp.canonical_transaction ct ON ct.occ_id = fe.occ_id AND ct.occ_timestamp > fe.t0
      GROUP BY fe.occ_id`,
  );
  const revByOcc = new Map(rev.rows.map((x) => [x.occ_id, Number(x.revenue)]));
  const journeysByOcc = new Map<string, { journeyId: string; name: string }[]>();
  for (const row of r.rows) {
    if (!journeysByOcc.has(row.occ_id)) journeysByOcc.set(row.occ_id, []);
    journeysByOcc.get(row.occ_id)!.push({ journeyId: row.journey_id, name: row.name });
  }
  const agg = new Map<string, { name: string; conversions: number; revenue: number }>();
  const bump = (jid: string, name: string, conv: number, rv: number) => {
    const cur = agg.get(jid) ?? { name, conversions: 0, revenue: 0 };
    cur.conversions += conv; cur.revenue += rv; agg.set(jid, cur);
  };
  let totalRevenue = 0;
  for (const [occ, js] of journeysByOcc) {
    const revenue = revByOcc.get(occ) ?? 0;
    if (revenue <= 0) continue;
    totalRevenue += revenue;
    if (model === "first") { const j = js[0]!; bump(j.journeyId, j.name, 1, revenue); }
    else if (model === "last") { const j = js[js.length - 1]!; bump(j.journeyId, j.name, 1, revenue); }
    else { const share = revenue / js.length; js.forEach((j) => bump(j.journeyId, j.name, 1 / js.length, share)); }
  }
  const journeys = [...agg.entries()].map(([journeyId, v]) => ({
    journeyId, name: v.name, conversions: Math.round(v.conversions), attributedRevenue: Math.round(v.revenue),
  })).sort((a, b) => b.attributedRevenue - a.attributedRevenue);
  return { model, journeys, totalRevenue: Math.round(totalRevenue) };
}

// ── Conversion funnel (cấu hình bước từ whitelist) ──
const FUNNEL_STEPS: Record<string, { label: string; cond: string }> = {
  identified: { label: "Định danh", cond: "1=1" },
  purchased: { label: "Có giao dịch", cond: "frequency >= 1" },
  repeat: { label: "Mua lại (≥2)", cond: "frequency >= 2" },
  multibrand: { label: "Đa thương hiệu", cond: "distinct_brands >= 2" },
  loyal: { label: "Trung thành (≥4)", cond: "frequency >= 4" },
  vip: { label: "VIP", cond: "lifecycle_stage = 'vip'" },
};

export interface Funnel {
  steps: { key: string; label: string; count: number; pct: number }[];
}

export async function conversionFunnel(pool: Pool, stepKeys?: string[]): Promise<Funnel> {
  const keys = (stepKeys && stepKeys.length > 0 ? stepKeys : ["identified", "purchased", "repeat", "multibrand", "vip"])
    .filter((k) => k in FUNNEL_STEPS);
  const total = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM cdp.customer_feature");
  const base = Number(total.rows[0]?.n ?? 0) || 1;
  const steps: Funnel["steps"] = [];
  for (const k of keys) {
    const s = FUNNEL_STEPS[k]!;
    const r = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM cdp.customer_feature WHERE ${s.cond}`);
    const count = Number(r.rows[0]?.n ?? 0);
    steps.push({ key: k, label: s.label, count, pct: Math.round((count / base) * 1000) / 10 });
  }
  return { steps };
}
