import type { Pool } from "pg";
import type { Ch } from "../clickhouse/client.js";
import { getTxAggregate, getRevenueByBrand, type BrandRevenue } from "../clickhouse/clickhouse.repo.js";

// Analytics: KPI Control Tower. transactions + revenue lấy từ lớp OLAP ClickHouse (realtime)
// khi có client; nếu CH lỗi/không cấu hình -> FALLBACK Postgres (system-of-record) để không
// gãy dashboard. Các chỉ số vận hành còn lại (loyalty/activation/master) đọc trực tiếp PG.

export interface Overview {
  customers: number;
  transactions: number;
  revenue: number;
  loyaltyAvailable: number;
  loyaltyReserved: number;
  activationAllowed: number;
  activationSuppressed: number;
  brands: number;
  stores: number;
  products: number;
}

// Circuit breaker đơn giản cho ClickHouse: khi CH lỗi/timeout, MỞ MẠCH trong COOLDOWN để các
// request sau phục vụ ngay từ Postgres (không chờ timeout lặp lại). Tự đóng sau cooldown.
const CH_COOLDOWN_MS = 15_000;
let chOpenUntilMs = 0;

/**
 * KPI tổng hợp. ch (optional): nguồn OLAP cho transactions + revenue (realtime). CH lỗi ->
 * MỞ MẠCH + fallback Postgres (resilience). Không truyền ch -> hoàn toàn từ Postgres.
 */
export async function getOverview(pool: Pool, ch?: Ch): Promise<Overview> {
  const pgOverview = await getOverviewFromPg(pool);
  if (!ch) return pgOverview;
  if (Date.now() < chOpenUntilMs) return pgOverview; // mạch đang mở -> bỏ qua CH, dùng PG ngay.
  try {
    const agg = await getTxAggregate(ch);
    return { ...pgOverview, transactions: agg.transactions, revenue: agg.revenue };
  } catch (err) {
    chOpenUntilMs = Date.now() + CH_COOLDOWN_MS; // mở mạch.
    // eslint-disable-next-line no-console
    console.warn(
      "[analytics] ClickHouse lỗi — mở mạch, fallback Postgres cho transactions/revenue:",
      (err as Error).message,
    );
    return pgOverview;
  }
}

/** Doanh thu theo thương hiệu — chỉ từ ClickHouse (OLAP group-by realtime). */
export async function getBrandRevenue(ch: Ch): Promise<BrandRevenue[]> {
  return getRevenueByBrand(ch);
}

export interface Insights {
  lifecycle: { stage: string; count: number }[];
  revenueByBrand: { brandId: string; revenue: number; transactions: number }[];
  topCategories: { category: string; orders: number }[];
  crossBrandCustomers: number; // KH mua ≥2 thương hiệu (synergy)
  totalWithFeature: number;
  avgChurnRisk: number;
}

/**
 * Phân tích chuyên sâu (PG-only, không cần ClickHouse): phân bố vòng đời, doanh thu theo
 * brand, nhóm hàng phổ biến, synergy cross-brand. Nguồn: customer_feature + canonical_transaction.
 */
export async function getInsights(pool: Pool): Promise<Insights> {
  const life = await pool.query<{ stage: string | null; count: string }>(
    `SELECT lifecycle_stage AS stage, count(*)::int AS count
       FROM cdp.customer_feature WHERE lifecycle_stage IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC`,
  );
  const rev = await pool.query<{ brand_id: string; revenue: string; transactions: string }>(
    `SELECT brand_id, COALESCE(sum(total),0)::bigint AS revenue, count(*)::int AS transactions
       FROM cdp.canonical_transaction GROUP BY brand_id ORDER BY revenue DESC`,
  );
  const cats = await pool.query<{ category: string; orders: string }>(
    `SELECT category_id AS category, count(DISTINCT message_id)::int AS orders
       FROM cdp.v_purchase_enriched WHERE category_id IS NOT NULL
       GROUP BY 1 ORDER BY 2 DESC LIMIT 8`,
  );
  const agg = await pool.query<{ cross: string; total: string; avg_churn: string | null }>(
    `SELECT count(*) FILTER (WHERE distinct_brands >= 2)::int AS cross,
            count(*)::int AS total,
            avg(churn_risk) AS avg_churn
       FROM cdp.customer_feature`,
  );
  const a = agg.rows[0]!;
  return {
    lifecycle: life.rows.map((x) => ({ stage: x.stage ?? "unknown", count: Number(x.count) })),
    revenueByBrand: rev.rows.map((x) => ({ brandId: x.brand_id, revenue: Number(x.revenue), transactions: Number(x.transactions) })),
    topCategories: cats.rows.map((x) => ({ category: x.category, orders: Number(x.orders) })),
    crossBrandCustomers: Number(a.cross),
    totalWithFeature: Number(a.total),
    avgChurnRisk: a.avg_churn === null ? 0 : Math.round(Number(a.avg_churn) * 1000) / 1000,
  };
}

async function getOverviewFromPg(pool: Pool): Promise<Overview> {
  const r = await pool.query<{
    customers: string;
    transactions: string;
    revenue: string;
    loyalty_available: string;
    loyalty_reserved: string;
    activation_allowed: string;
    activation_suppressed: string;
    brands: string;
    stores: string;
    products: string;
  }>(
    `SELECT
       (SELECT count(*) FROM cdp.occ_identity WHERE status='active')        AS customers,
       (SELECT count(*) FROM cdp.canonical_transaction)                     AS transactions,
       (SELECT COALESCE(sum(total),0) FROM cdp.canonical_transaction)       AS revenue,
       (SELECT COALESCE(sum(delta),0) FROM cdp.loyalty_entry
          WHERE account LIKE 'member:%:available')                          AS loyalty_available,
       (SELECT COALESCE(sum(delta),0) FROM cdp.loyalty_entry
          WHERE account LIKE 'member:%:reserved')                           AS loyalty_reserved,
       (SELECT COALESCE(sum(allowed_count),0) FROM cdp.activation_run)      AS activation_allowed,
       (SELECT COALESCE(sum(suppressed_count),0) FROM cdp.activation_run)   AS activation_suppressed,
       (SELECT count(*) FROM cdp.brand)                                     AS brands,
       (SELECT count(*) FROM cdp.store)                                     AS stores,
       (SELECT count(*) FROM cdp.product_master)                           AS products`,
  );
  const row = r.rows[0]!;
  return {
    customers: Number(row.customers),
    transactions: Number(row.transactions),
    revenue: Number(row.revenue),
    loyaltyAvailable: Number(row.loyalty_available),
    loyaltyReserved: Number(row.loyalty_reserved),
    activationAllowed: Number(row.activation_allowed),
    activationSuppressed: Number(row.activation_suppressed),
    brands: Number(row.brands),
    stores: Number(row.stores),
    products: Number(row.products),
  };
}
