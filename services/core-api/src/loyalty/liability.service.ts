import type { Pool, PoolClient } from "pg";
import { LoyaltyError, type LotSlice } from "./loyalty.service.js";

// L7 — Liability (IFRS15/ASC606) + inter-company settlement. Nghĩa vụ điểm = outstanding × unit value
// × (1-breakage) = deferred revenue, CẮT THEO pháp nhân phát hành (loyalty_lot.issuing_company_id).
// Settlement credit-in-arrears: điểm phát ở cty A tiêu ở cty B -> A bù cho B (ghi nhận tại redeem).

export interface PointPriceInput { currencyCode: string; companyCode?: string | null | undefined; pricePerPoint: number; breakageRate?: number | undefined; }

/** Đặt đơn giá điểm + breakage (append-only: đóng bản mở cũ, mở bản mới). */
export async function setPointPrice(pool: Pool, a: PointPriceInput): Promise<void> {
  if (!(a.pricePerPoint >= 0)) throw new LoyaltyError("INVALID_AMOUNT", "price_per_point phải >= 0.");
  if (a.breakageRate !== undefined && !(a.breakageRate >= 0 && a.breakageRate < 1)) {
    throw new LoyaltyError("INVALID_AMOUNT", "breakage_rate phải trong [0,1).");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code=$1", [a.currencyCode]);
    if (!cur.rows[0]) throw new LoyaltyError("CURRENCY_NOT_FOUND", `Loại điểm không tồn tại: ${a.currencyCode}`);
    let companyId: string | null = null;
    if (a.companyCode) {
      const co = await client.query<{ id: string }>("SELECT id FROM cdp.company WHERE code=$1", [a.companyCode]);
      if (!co.rows[0]) throw new LoyaltyError("REWARD_NOT_FOUND", `Pháp nhân không tồn tại: ${a.companyCode}`);
      companyId = co.rows[0]!.id;
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`point_price:${cur.rows[0]!.id}:${companyId ?? "null"}`]);
    await client.query(
      `UPDATE cdp.point_price SET valid_to=now() WHERE currency_id=$1
         AND COALESCE(issuing_company_id,'00000000-0000-0000-0000-000000000000'::uuid)=COALESCE($2::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
         AND valid_to IS NULL`, [cur.rows[0]!.id, companyId]);
    await client.query(
      "INSERT INTO cdp.point_price (currency_id, issuing_company_id, price_per_point, breakage_rate) VALUES ($1,$2,$3,$4)",
      [cur.rows[0]!.id, companyId, a.pricePerPoint, a.breakageRate ?? 0]);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
}

export interface LiabilityRow {
  companyId: string | null; companyCode: string | null; currencyId: string; currencyCode: string;
  outstandingPoints: number; unitValue: number; breakageRate: number;
  grossLiability: number; deferredRevenue: number; breakageRevenue: number;
}

/**
 * Tính + LƯU snapshot nghĩa vụ điểm hiện tại: per (issuing_company, currency), outstanding = Σ lô
 * active còn điểm; unit value + breakage lấy từ point_price (ưu tiên bản theo công ty, fallback chung).
 * gross = outstanding×unit; deferred_revenue = gross×(1-breakage); breakage_revenue = gross×breakage.
 * Trả các dòng đã tính. Snapshot append-only (audit).
 */
export async function computeLiabilitySnapshot(pool: Pool): Promise<LiabilityRow[]> {
  // TOÀN BỘ số tiền tính trong SQL numeric (audit-grade, không JS float). outstanding = lô active
  // (available) + điểm RESERVED (consumed_lots của reservation 'held' — vẫn là nghĩa vụ). Emit dòng 0
  // cho cặp (company,currency) từng có snapshot nhưng nay cạn (liability giảm về 0, không stale).
  const r = await pool.query<Record<string, unknown>>(
    `WITH src AS (
       SELECT l.issuing_company_id AS company, l.currency_id AS currency, l.points_remaining::numeric AS pts
         FROM cdp.loyalty_lot l JOIN cdp.point_currency pc ON pc.id=l.currency_id
        WHERE l.status='active' AND l.points_remaining > 0 AND pc.kind <> 'STORED_VALUE'
       UNION ALL
       -- Điểm reserved (đang held) — bám issuing company gốc trong consumed_lots; currency = GROUP
       -- (reserve hiện chạy trên GROUP currency).
       SELECT (elem->>'c')::uuid AS company,
              (SELECT id FROM cdp.point_currency WHERE code='OCC_POINT') AS currency,
              (elem->>'p')::numeric AS pts
         FROM cdp.loyalty_reservation res, jsonb_array_elements(res.consumed_lots) elem
        WHERE res.status='held'
       UNION ALL
       -- Cặp lịch sử (để emit 0 khi đã cạn) — pts 0 không đổi tổng.
       SELECT DISTINCT company_id AS company, currency_id AS currency, 0::numeric AS pts
         FROM cdp.liability_snapshot
     ),
     agg AS (SELECT company, currency, SUM(pts) AS pts FROM src GROUP BY company, currency),
     priced AS (
       SELECT a.company, a.currency, a.pts,
              COALESCE((SELECT price_per_point FROM cdp.point_price p
                         WHERE p.currency_id=a.currency AND (p.issuing_company_id=a.company OR p.issuing_company_id IS NULL)
                           AND p.valid_from<=now() AND (p.valid_to IS NULL OR p.valid_to>now())
                         ORDER BY (p.issuing_company_id IS NOT NULL) DESC, p.valid_from DESC LIMIT 1),0) AS unit,
              COALESCE((SELECT breakage_rate FROM cdp.point_price p
                         WHERE p.currency_id=a.currency AND (p.issuing_company_id=a.company OR p.issuing_company_id IS NULL)
                           AND p.valid_from<=now() AND (p.valid_to IS NULL OR p.valid_to>now())
                         ORDER BY (p.issuing_company_id IS NOT NULL) DESC, p.valid_from DESC LIMIT 1),0) AS brk
         FROM agg a
     ),
     ins AS (
       INSERT INTO cdp.liability_snapshot (company_id, currency_id, outstanding_points, unit_value, breakage_rate,
              gross_liability, deferred_revenue, breakage_revenue)
       SELECT company, currency, pts::bigint, unit, brk,
              pts*unit, pts*unit*(1-brk), pts*unit*brk FROM priced
       RETURNING company_id, currency_id, outstanding_points::text AS op, unit_value::text AS uv,
                 breakage_rate::text AS br, gross_liability::text AS gl, deferred_revenue::text AS dr, breakage_revenue::text AS brv
     )
     SELECT ins.*, co.code AS company_code, c.code AS currency_code
       FROM ins JOIN cdp.point_currency c ON c.id=ins.currency_id
       LEFT JOIN cdp.company co ON co.id=ins.company_id`);
  return r.rows.map((x) => ({
    companyId: (x["company_id"] as string) ?? null, companyCode: (x["company_code"] as string) ?? null,
    currencyId: x["currency_id"] as string, currencyCode: x["currency_code"] as string,
    outstandingPoints: Number(x["op"]), unitValue: Number(x["uv"]), breakageRate: Number(x["br"]),
    grossLiability: Number(x["gl"]), deferredRevenue: Number(x["dr"]), breakageRevenue: Number(x["brv"]),
  }));
}

/** Snapshot nghĩa vụ MỚI NHẤT theo (company, currency). */
export async function getLatestLiability(pool: Pool): Promise<LiabilityRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT DISTINCT ON (ls.company_id, ls.currency_id)
            ls.company_id, co.code AS company_code, ls.currency_id, c.code AS currency_code,
            ls.outstanding_points, ls.unit_value, ls.breakage_rate, ls.gross_liability, ls.deferred_revenue, ls.breakage_revenue
       FROM cdp.liability_snapshot ls
       JOIN cdp.point_currency c ON c.id=ls.currency_id
       LEFT JOIN cdp.company co ON co.id=ls.company_id
      ORDER BY ls.company_id, ls.currency_id, ls.as_of DESC, ls.id DESC`);
  return r.rows.map((x) => ({
    companyId: (x["company_id"] as string) ?? null, companyCode: (x["company_code"] as string) ?? null,
    currencyId: x["currency_id"] as string, currencyCode: x["currency_code"] as string,
    outstandingPoints: Number(x["outstanding_points"]), unitValue: Number(x["unit_value"]), breakageRate: Number(x["breakage_rate"]),
    grossLiability: Number(x["gross_liability"]), deferredRevenue: Number(x["deferred_revenue"]), breakageRevenue: Number(x["breakage_revenue"]),
  }));
}

/**
 * Ghi nghĩa vụ settlement khi REDEEM burn điểm: mỗi lát điểm burn thuộc pháp nhân phát hành (slice.c);
 * nếu tiêu ở pháp nhân KHÁC (redeemingCompany) -> issuing bù cho redeeming (points × unit value).
 * Gom theo issuing company, idempotent theo (redeemTxn, issuing). Chạy TRONG txn của caller.
 */
export async function recordSettlementForRedeemTx(
  client: PoolClient,
  a: { redeemTxnId: string; slices: LotSlice[]; redeemingCompanyId: string | null; currencyId: string },
): Promise<void> {
  // Gom điểm burn theo issuing company (BigInt precision).
  const byCompany = new Map<string | null, bigint>();
  for (const s of a.slices) byCompany.set(s.c, (byCompany.get(s.c) ?? 0n) + BigInt(s.p));
  const period = (await client.query<{ p: string }>("SELECT to_char(now(),'YYYY-MM') AS p")).rows[0]!.p;
  for (const [issuing, pts] of byCompany) {
    if (issuing === null || issuing === a.redeemingCompanyId || pts <= 0n) continue; // cùng cty / chưa gắn -> không settle
    // FAIL-CLOSED: bắt buộc có point_price cho cặp (currency, issuing|null) TRƯỚC khi ghi nghĩa vụ tiền
    // -> KHÔNG ghi dòng 0đ khóa cứng (không thể tính lại sau khi set giá). Amount tính SQL numeric.
    const priceRow = await client.query<{ unit: string }>(
      `SELECT price_per_point::text AS unit FROM cdp.point_price
        WHERE currency_id=$1 AND (issuing_company_id=$2 OR issuing_company_id IS NULL)
          AND valid_from<=now() AND (valid_to IS NULL OR valid_to>now())
        ORDER BY (issuing_company_id IS NOT NULL) DESC, valid_from DESC LIMIT 1`, [a.currencyId, issuing]);
    if (!priceRow.rows[0]) {
      throw new LoyaltyError("SETTLEMENT_PRICE_MISSING", "Chưa cấu hình đơn giá điểm (point_price) cho loại điểm — không thể ghi nghĩa vụ bù trừ inter-company.");
    }
    await client.query(
      `INSERT INTO cdp.settlement_txn (period, issuing_company_id, redeeming_company_id, currency_id, points, unit_value, amount, ref_txn, idempotency_key)
       VALUES ($1,$2,$3,$4,$5::bigint,$6::numeric,$5::numeric*$6::numeric,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING`,
      [period, issuing, a.redeemingCompanyId, a.currencyId, pts.toString(), priceRow.rows[0]!.unit, a.redeemTxnId, `settle:${a.redeemTxnId}:${issuing}`]);
  }
}

export interface SettlementNetRow { period: string; fromCompany: string | null; toCompany: string | null; amount: number; points: number; }

/** Báo cáo settlement theo kỳ: tổng nghĩa vụ (issuing bù redeeming) gom theo cặp pháp nhân. */
export async function getSettlementReport(pool: Pool, period: string): Promise<SettlementNetRow[]> {
  const r = await pool.query<{ from_code: string | null; to_code: string | null; amount: string; points: string }>(
    `SELECT ci.code AS from_code, cr.code AS to_code, SUM(s.amount)::text AS amount, SUM(s.points)::bigint::text AS points
       FROM cdp.settlement_txn s
       LEFT JOIN cdp.company ci ON ci.id=s.issuing_company_id
       LEFT JOIN cdp.company cr ON cr.id=s.redeeming_company_id
      WHERE s.period=$1 GROUP BY ci.code, cr.code ORDER BY ci.code`, [period]);
  return r.rows.map((x) => ({ period, fromCompany: x.from_code, toCompany: x.to_code, amount: Number(x.amount), points: Number(x.points) }));
}
