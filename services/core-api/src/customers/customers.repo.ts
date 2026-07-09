import type { Pool } from "pg";

// Customer Directory — danh sách khách hàng (list) đọc từ golden record + feature.
// Chỉ trả khách active, chưa bị hợp nhất (merged_into IS NULL).

export interface CustomerListItem {
  occId: string;
  fullName: string | null;
  city: string | null;
  lifecycleStage: string | null;
  monetary: number;
  frequency: number;
  distinctBrands: number;
  lastOrderAt: string | null;
  loyaltyAvailable: number;
}

export interface CustomerListResult {
  rows: CustomerListItem[];
  total: number;
}

// Cột thô trả về từ pg (bigint -> string, timestamptz -> Date).
interface RawRow {
  occId: string;
  fullName: string | null;
  city: string | null;
  lifecycleStage: string | null;
  monetary: string | null;
  frequency: number | null;
  distinctBrands: number | null;
  lastOrderAt: Date | null;
  loyaltyAvailable: string | null;
}

/**
 * Liệt kê khách hàng có phân trang + lọc.
 * - search: khớp tên đầy đủ HOẶC bất kỳ identifier chuẩn hoá (phone/email/...).
 * - lifecycle: lọc theo giai đoạn vòng đời (customer_feature.lifecycle_stage).
 * Toàn bộ tham số hoá $1.. (KHÔNG nội suy chuỗi vào SQL) để chống SQL injection.
 */
export async function listCustomers(
  pool: Pool,
  opts: {
    search?: string | undefined;
    lifecycle?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  },
): Promise<CustomerListResult> {
  const conds: string[] = ["o.status='active'", "o.merged_into IS NULL"];
  const params: unknown[] = [];

  if (opts.search !== undefined && opts.search !== "") {
    params.push(`%${opts.search}%`);
    const p = `$${params.length}`;
    conds.push(
      `(p.full_name ILIKE ${p} OR EXISTS(` +
        `SELECT 1 FROM cdp.identity_edge e ` +
        `WHERE e.occ_id=o.occ_id AND e.value_normalized ILIKE ${p}))`,
    );
  }
  if (opts.lifecycle !== undefined) {
    params.push(opts.lifecycle);
    conds.push(`cf.lifecycle_stage = $${params.length}`);
  }

  const fromWhere =
    `FROM cdp.occ_identity o ` +
    `JOIN cdp.profile p ON p.occ_id = o.occ_id ` +
    `LEFT JOIN cdp.customer_feature cf ON cf.occ_id = o.occ_id ` +
    `WHERE ${conds.join(" AND ")}`;

  // Tổng số bản ghi (cùng WHERE, KHÔNG limit).
  const totalRes = await pool.query<{ total: string }>(
    `SELECT count(*)::bigint AS total ${fromWhere}`,
    params,
  );
  const total = Number(totalRes.rows[0]?.total ?? 0);

  // Phân trang an toàn: limit mặc định 25 (tối đa 100), offset mặc định 0.
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const limitParam = `$${params.length + 1}`;
  const offsetParam = `$${params.length + 2}`;

  const rowsRes = await pool.query<RawRow>(
    `SELECT o.occ_id            AS "occId",
            p.full_name         AS "fullName",
            p.city              AS "city",
            cf.lifecycle_stage  AS "lifecycleStage",
            cf.monetary         AS "monetary",
            cf.frequency        AS "frequency",
            cf.distinct_brands  AS "distinctBrands",
            cf.last_order_at    AS "lastOrderAt",
            cf.loyalty_available AS "loyaltyAvailable"
       ${fromWhere}
      ORDER BY cf.monetary DESC NULLS LAST, p.full_name ASC
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    [...params, limit, offset],
  );

  const rows: CustomerListItem[] = rowsRes.rows.map((r) => ({
    occId: r.occId,
    fullName: r.fullName,
    city: r.city,
    lifecycleStage: r.lifecycleStage,
    monetary: r.monetary === null ? 0 : Number(r.monetary),
    frequency: r.frequency ?? 0,
    distinctBrands: r.distinctBrands ?? 0,
    lastOrderAt: r.lastOrderAt === null ? null : new Date(r.lastOrderAt).toISOString(),
    loyaltyAvailable: r.loyaltyAvailable === null ? 0 : Number(r.loyaltyAvailable),
  }));

  return { rows, total };
}
