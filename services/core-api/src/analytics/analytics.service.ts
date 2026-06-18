import type { Pool } from "pg";

// Analytics GĐ1: tổng hợp KPI Control Tower từ Postgres (system of record). Khi lượng dữ
// liệu lớn, lớp OLAP ClickHouse sẽ đảm nhận realtime (xem DESIGN.md) — interface giữ nguyên.

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

export async function getOverview(pool: Pool): Promise<Overview> {
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
