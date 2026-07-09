import type { Pool } from "pg";

// Phân tích hành vi mua chuyên sâu cho Customer 360 (tham chiếu CDP mạnh: Klaviyo/Adobe/
// Treasure Data): giá trị (CLV/AOV), nhịp mua (khoảng cách đơn + dự đoán đơn kế tiếp),
// xu hướng chi tiêu theo tháng, ưa thích thương hiệu/nhóm hàng/cửa hàng, thời điểm mua.
// Tất cả tính TỪ giao dịch thật (cdp.canonical_transaction) — không bịa.

export interface CustomerAnalytics {
  summary: {
    orderCount: number;
    totalSpend: number;
    aov: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    tenureDays: number | null;
  };
  cadence: {
    avgIntervalDays: number | null;
    predictedNextPurchaseAt: string | null;
    daysUntilNext: number | null; // âm = quá hạn mua
  };
  predictedClv: number;
  monthlySpend: { month: string; spend: number; orders: number }[];
  brandBreakdown: { brandId: string; spend: number; orders: number; pct: number }[];
  categoryBreakdown: { categoryId: string | null; spend: number; pct: number }[];
  topStores: { storeId: string; orders: number; spend: number }[];
  dow: number[]; // 7 phần tử, index 0 = Chủ nhật
  paymentMix: { method: string; count: number }[];
}

const DAY_MS = 86_400_000;

export async function getCustomerAnalytics(pool: Pool, occId: string, now: Date = new Date()): Promise<CustomerAnalytics> {
  const [summaryQ, monthlyQ, brandQ, catQ, storeQ, dowQ, payQ] = await Promise.all([
    pool.query<{ n: string; spend: string | null; first_at: string | null; last_at: string | null }>(
      `SELECT count(*)::text AS n, sum(total)::text AS spend,
              min(occ_timestamp) AS first_at, max(occ_timestamp) AS last_at
         FROM cdp.canonical_transaction WHERE occ_id=$1`,
      [occId],
    ),
    pool.query<{ ym: string; spend: string; orders: string }>(
      `SELECT to_char(date_trunc('month', occ_timestamp), 'YYYY-MM') AS ym,
              sum(total)::text AS spend, count(*)::text AS orders
         FROM cdp.canonical_transaction WHERE occ_id=$1
         GROUP BY 1 ORDER BY 1`,
      [occId],
    ),
    pool.query<{ brand_id: string; spend: string; orders: string }>(
      `SELECT brand_id, sum(total)::text AS spend, count(*)::text AS orders
         FROM cdp.canonical_transaction WHERE occ_id=$1
         GROUP BY brand_id ORDER BY sum(total) DESC`,
      [occId],
    ),
    pool.query<{ category_id: string | null; spend: string }>(
      `SELECT pm.category_id,
              sum((it->>'quantity')::numeric * (it->>'unit_price')::numeric)::text AS spend
         FROM cdp.canonical_transaction t
         CROSS JOIN LATERAL jsonb_array_elements(t.items) AS it
         LEFT JOIN cdp.product_master pm ON pm.product_master_id = it->>'sku'
         WHERE t.occ_id=$1
         GROUP BY pm.category_id ORDER BY sum((it->>'quantity')::numeric * (it->>'unit_price')::numeric) DESC`,
      [occId],
    ),
    pool.query<{ store_id: string; orders: string; spend: string }>(
      `SELECT store_id, count(*)::text AS orders, sum(total)::text AS spend
         FROM cdp.canonical_transaction WHERE occ_id=$1 AND store_id IS NOT NULL
         GROUP BY store_id ORDER BY sum(total) DESC LIMIT 5`,
      [occId],
    ),
    pool.query<{ d: string; c: string }>(
      `SELECT extract(dow from occ_timestamp)::int::text AS d, count(*)::text AS c
         FROM cdp.canonical_transaction WHERE occ_id=$1 GROUP BY 1`,
      [occId],
    ),
    pool.query<{ payment_method: string | null; c: string }>(
      `SELECT payment_method, count(*)::text AS c
         FROM cdp.canonical_transaction WHERE occ_id=$1
         GROUP BY payment_method ORDER BY count(*) DESC`,
      [occId],
    ),
  ]);

  const s = summaryQ.rows[0]!;
  const orderCount = Number(s.n);
  const totalSpend = Number(s.spend ?? 0);
  const aov = orderCount > 0 ? Math.round(totalSpend / orderCount) : 0;
  const firstOrderAt = s.first_at;
  const lastOrderAt = s.last_at;
  const tenureDays =
    firstOrderAt && lastOrderAt
      ? Math.max(0, Math.round((new Date(lastOrderAt).getTime() - new Date(firstOrderAt).getTime()) / DAY_MS))
      : null;

  // Nhịp mua: khoảng cách trung bình giữa các đơn = tenure / (n-1). Dự đoán đơn kế tiếp.
  const avgIntervalDays = orderCount > 1 && tenureDays !== null ? Math.round(tenureDays / (orderCount - 1)) : null;
  let predictedNextPurchaseAt: string | null = null;
  let daysUntilNext: number | null = null;
  if (avgIntervalDays !== null && lastOrderAt) {
    const next = new Date(new Date(lastOrderAt).getTime() + avgIntervalDays * DAY_MS);
    predictedNextPurchaseAt = next.toISOString();
    daysUntilNext = Math.round((next.getTime() - now.getTime()) / DAY_MS);
  }

  // CLV dự đoán: giá trị đơn TB × số đơn/năm dự kiến × chân trời 2 năm (chặn trên hợp lý).
  const ordersPerYear = avgIntervalDays && avgIntervalDays > 0 ? 365 / avgIntervalDays : orderCount;
  const predictedClv = Math.round(Math.min(aov * ordersPerYear * 2, totalSpend * 6 + aov * 4));

  const brandTotal = brandQ.rows.reduce((a, b) => a + Number(b.spend), 0) || 1;
  const catTotal = catQ.rows.reduce((a, c) => a + Number(c.spend), 0) || 1;

  const dow = Array<number>(7).fill(0);
  for (const row of dowQ.rows) dow[Number(row.d)] = Number(row.c);

  return {
    summary: { orderCount, totalSpend, aov, firstOrderAt, lastOrderAt, tenureDays },
    cadence: { avgIntervalDays, predictedNextPurchaseAt, daysUntilNext },
    predictedClv,
    monthlySpend: monthlyQ.rows.map((m) => ({ month: m.ym, spend: Number(m.spend), orders: Number(m.orders) })),
    brandBreakdown: brandQ.rows.map((b) => ({
      brandId: b.brand_id, spend: Number(b.spend), orders: Number(b.orders),
      pct: Math.round((Number(b.spend) / brandTotal) * 100),
    })),
    categoryBreakdown: catQ.rows.map((c) => ({
      categoryId: c.category_id, spend: Number(c.spend),
      pct: Math.round((Number(c.spend) / catTotal) * 100),
    })),
    topStores: storeQ.rows.map((s2) => ({ storeId: s2.store_id, orders: Number(s2.orders), spend: Number(s2.spend) })),
    dow,
    paymentMix: payQ.rows.map((p) => ({ method: p.payment_method ?? "unknown", count: Number(p.c) })),
  };
}
