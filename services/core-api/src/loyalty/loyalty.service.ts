import type { Pool, PoolClient } from "pg";

// Loyalty double-entry. Balance = projection từ cdp.loyalty_entry (không cột mutable).
// Mỗi thao tác đổi số dư: advisory lock theo occ_id để serialize (chống double-spend),
// idempotency_key unique + fingerprint (replay-safe, reject reuse-key sai tham số),
// và mọi txn có tổng delta = 0 (DB constraint trigger + service). capture/release gắn vào
// MỘT reservation cụ thể (state machine held->captured|released) tránh consume nhầm.

export type LoyaltyErrorCode =
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_RESERVED"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_INVALID_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "CURRENCY_NOT_FOUND"
  | "CONVERSION_NOT_FOUND";

export class LoyaltyError extends Error {
  readonly code: LoyaltyErrorCode;
  constructor(code: LoyaltyErrorCode, message: string) {
    super(message);
    this.name = "LoyaltyError";
    this.code = code;
  }
}

export interface LoyaltyBalance {
  available: number;
  reserved: number;
}

export interface LoyaltyResult {
  txnId: string;
  balance: LoyaltyBalance;
  idempotent: boolean;
}

export interface ReserveResult extends LoyaltyResult {
  reservationId: string;
}

const acc = {
  available: (occId: string) => `member:${occId}:available`,
  reserved: (occId: string) => `member:${occId}:reserved`,
  issued: "system:issued",
  redeemed: "system:redeemed",
};

// Ledger đa-currency: GROUP currency (điểm chung 'OCC_POINT') là mặc định cho kernel cũ (tương
// thích ngược). Cache id sau lần đọc đầu. Các thao tác đa-currency (convert...) truyền currency riêng.
let groupCurrencyId: string | null = null;
async function getGroupCurrencyId(client: PoolClient): Promise<string> {
  if (groupCurrencyId) return groupCurrencyId;
  const r = await client.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='OCC_POINT'");
  if (!r.rows[0]) throw new Error("Chưa seed GROUP currency OCC_POINT (migration 025).");
  groupCurrencyId = r.rows[0]!.id;
  return groupCurrencyId;
}
/** Chỉ dùng cho test: xoá cache khi DB bị dựng lại. */
export function _resetLoyaltyCurrencyCache(): void {
  groupCurrencyId = null;
}

const MAX_POINTS = 1_000_000_000; // trần an toàn, dưới Number.MAX_SAFE_INTEGER rất xa

function assertValidPoints(points: number): void {
  if (!Number.isSafeInteger(points) || points <= 0 || points > MAX_POINTS) {
    throw new LoyaltyError(
      "INVALID_AMOUNT",
      `Số điểm phải là số nguyên dương <= ${MAX_POINTS}.`,
    );
  }
}

interface OpMeta {
  occId: string;
  idempotencyKey: string;
  type: string;
  fingerprint: string;
  reason?: string;
}

interface OpCtx {
  client: PoolClient;
  txnId: string;
}

/**
 * Khung thực thi một thao tác loyalty: BEGIN + advisory lock theo occ_id + idempotency
 * (key + fingerprint). Nếu key đã tồn tại: fingerprint khớp -> idempotent; lệch -> 409.
 * `work` chạy trong txn để post entry + side-effect (reservation). Lỗi -> ROLLBACK.
 */
async function runOp(
  pool: Pool,
  meta: OpMeta,
  work: (ctx: OpCtx) => Promise<void>,
): Promise<LoyaltyResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `loyalty:${meta.occId}`,
    ]);

    const existing = await client.query<{ txn_id: string; fingerprint: string }>(
      "SELECT txn_id, fingerprint FROM cdp.loyalty_txn WHERE idempotency_key=$1",
      [meta.idempotencyKey],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0]!;
      if (row.fingerprint !== meta.fingerprint) {
        throw new LoyaltyError(
          "IDEMPOTENCY_CONFLICT",
          "idempotency_key đã dùng cho thao tác khác (tham số không khớp).",
        );
      }
      const balance = await balanceTx(client, meta.occId, await getGroupCurrencyId(client));
      await client.query("COMMIT");
      return { txnId: row.txn_id, balance, idempotent: true };
    }

    const ins = await client.query<{ txn_id: string }>(
      `INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint, reason)
       VALUES ($1,$2,$3,$4,$5) RETURNING txn_id`,
      [meta.idempotencyKey, meta.type, meta.occId, meta.fingerprint, meta.reason ?? null],
    );
    const txnId = ins.rows[0]!.txn_id;

    await work({ client, txnId });

    const balance = await balanceTx(client, meta.occId, await getGroupCurrencyId(client));
    await client.query("COMMIT");
    return { txnId, balance, idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

interface Line { account: string; delta: number; currencyId: string }
async function postEntries(ctx: OpCtx, lines: Line[]): Promise<void> {
  // Cân theo TỪNG currency (khớp trigger DB per (txn,currency)) — hỗ trợ txn đa-currency (convert).
  const byCur = new Map<string, number>();
  for (const l of lines) byCur.set(l.currencyId, (byCur.get(l.currencyId) ?? 0) + l.delta);
  for (const [cur, s] of byCur) {
    if (s !== 0) throw new Error(`loyalty: bút toán không cân cho currency ${cur} (tổng delta != 0)`);
  }
  for (const line of lines) {
    await ctx.client.query(
      "INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,$3,$4)",
      [ctx.txnId, line.account, line.delta, line.currencyId],
    );
  }
}

async function accountBalanceTx(client: PoolClient, account: string, currencyId: string): Promise<number> {
  const r = await client.query<{ bal: string | null }>(
    "SELECT COALESCE(sum(delta),0)::bigint AS bal FROM cdp.loyalty_entry WHERE account=$1 AND currency_id=$2",
    [account, currencyId],
  );
  return Number(r.rows[0]!.bal ?? 0);
}

async function balanceTx(client: PoolClient, occId: string, currencyId: string): Promise<LoyaltyBalance> {
  const [available, reserved] = await Promise.all([
    accountBalanceTx(client, acc.available(occId), currencyId),
    accountBalanceTx(client, acc.reserved(occId), currencyId),
  ]);
  return { available, reserved };
}

export interface EarnArgs {
  occId: string;
  points: number;
  idempotencyKey: string;
  reason?: string;
}

/** Phát hành điểm: +available, -issued (liability). */
export async function earn(pool: Pool, a: EarnArgs): Promise<LoyaltyResult> {
  assertValidPoints(a.points);
  return runOp(
    pool,
    {
      occId: a.occId,
      idempotencyKey: a.idempotencyKey,
      type: "earn",
      fingerprint: `earn:${a.occId}:${a.points}`,
      ...(a.reason !== undefined ? { reason: a.reason } : {}),
    },
    async (ctx) => {
      const cur = await getGroupCurrencyId(ctx.client);
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: a.points, currencyId: cur },
        { account: acc.issued, delta: -a.points, currencyId: cur },
      ]);
    },
  );
}

export interface ReserveArgs {
  occId: string;
  points: number;
  idempotencyKey: string;
}

/** Giữ điểm: available -> reserved; tạo reservation (held). Cấm âm available. */
export async function reserve(pool: Pool, a: ReserveArgs): Promise<ReserveResult> {
  assertValidPoints(a.points);
  let reservationId: string | null = null;

  const res = await runOp(
    pool,
    {
      occId: a.occId,
      idempotencyKey: a.idempotencyKey,
      type: "reserve",
      fingerprint: `reserve:${a.occId}:${a.points}`,
    },
    async (ctx) => {
      const cur = await getGroupCurrencyId(ctx.client);
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: -a.points, currencyId: cur },
        { account: acc.reserved(a.occId), delta: a.points, currencyId: cur },
      ]);
      const avail = await accountBalanceTx(ctx.client, acc.available(a.occId), cur);
      if (avail < 0) {
        throw new LoyaltyError("INSUFFICIENT_BALANCE", "Không đủ điểm khả dụng để giữ.");
      }
      const r = await ctx.client.query<{ reservation_id: string }>(
        `INSERT INTO cdp.loyalty_reservation (occ_id, points, reserve_txn)
         VALUES ($1,$2,$3) RETURNING reservation_id`,
        [a.occId, a.points, ctx.txnId],
      );
      reservationId = r.rows[0]!.reservation_id;
    },
  );

  // Replay idempotent: work không chạy -> lấy reservationId từ reserve_txn.
  if (reservationId === null) {
    const r = await pool.query<{ reservation_id: string }>(
      "SELECT reservation_id FROM cdp.loyalty_reservation WHERE reserve_txn=$1",
      [res.txnId],
    );
    reservationId = r.rows[0]?.reservation_id ?? null;
  }
  if (reservationId === null) {
    throw new LoyaltyError("RESERVATION_NOT_FOUND", "Không tìm thấy reservation sau khi giữ.");
  }
  return { ...res, reservationId };
}

export interface ReservationOpArgs {
  reservationId: string;
  idempotencyKey: string;
}

/** Chốt tiêu điểm theo reservation cụ thể: reserved -> redeemed. held -> captured. */
export function capture(pool: Pool, a: ReservationOpArgs): Promise<LoyaltyResult> {
  return settleReservation(pool, a, "capture");
}

/** Hủy giữ theo reservation cụ thể: reserved -> available. held -> released. */
export function release(pool: Pool, a: ReservationOpArgs): Promise<LoyaltyResult> {
  return settleReservation(pool, a, "release");
}

async function settleReservation(
  pool: Pool,
  a: ReservationOpArgs,
  mode: "capture" | "release",
): Promise<LoyaltyResult> {
  // occ_id cần có trước khi vào lock; trạng thái sẽ được khóa lại trong txn.
  const head = await pool.query<{ occ_id: string }>(
    "SELECT occ_id FROM cdp.loyalty_reservation WHERE reservation_id=$1",
    [a.reservationId],
  );
  const occId = head.rows[0]?.occ_id;
  if (!occId) {
    throw new LoyaltyError("RESERVATION_NOT_FOUND", "Reservation không tồn tại.");
  }

  return runOp(
    pool,
    {
      occId,
      idempotencyKey: a.idempotencyKey,
      type: mode,
      fingerprint: `${mode}:${a.reservationId}`,
    },
    async (ctx) => {
      const r = await ctx.client.query<{ points: string; status: string }>(
        "SELECT points, status FROM cdp.loyalty_reservation WHERE reservation_id=$1 FOR UPDATE",
        [a.reservationId],
      );
      const row = r.rows[0]!;
      if (row.status !== "held") {
        throw new LoyaltyError(
          "RESERVATION_INVALID_STATE",
          `Reservation đã ở trạng thái '${row.status}', không thể ${mode}.`,
        );
      }
      const points = Number(row.points);
      const cur = await getGroupCurrencyId(ctx.client);
      const lines: Line[] =
        mode === "capture"
          ? [
              { account: acc.reserved(occId), delta: -points, currencyId: cur },
              { account: acc.redeemed, delta: points, currencyId: cur },
            ]
          : [
              { account: acc.reserved(occId), delta: -points, currencyId: cur },
              { account: acc.available(occId), delta: points, currencyId: cur },
            ];
      await postEntries(ctx, lines);
      await ctx.client.query(
        "UPDATE cdp.loyalty_reservation SET status=$2, updated_at=now() WHERE reservation_id=$1",
        [a.reservationId, mode === "capture" ? "captured" : "released"],
      );
    },
  );
}

/** Số dư điểm CHUNG (group currency) của 1 khách — mặc định (tương thích ngược). */
// ── L1: đa-currency (convert / adjust / transfer) ──

async function resolveCurrencyId(client: PoolClient, codeOrId: string): Promise<string> {
  // Chấp nhận code (vd 'GIVRAL_PT') hoặc uuid; is_active bắt buộc.
  const r = await client.query<{ id: string }>(
    "SELECT id FROM cdp.point_currency WHERE (code=$1 OR id::text=$1) AND is_active",
    [codeOrId],
  );
  if (!r.rows[0]) throw new LoyaltyError("CURRENCY_NOT_FOUND", `Loại điểm không tồn tại/không hoạt động: ${codeOrId}`);
  return r.rows[0]!.id;
}

async function getConversionRate(client: PoolClient, fromId: string, toId: string): Promise<number> {
  const r = await client.query<{ rate: string }>(
    `SELECT rate::text AS rate FROM cdp.point_conversion
      WHERE from_currency_id=$1 AND to_currency_id=$2
        AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
      ORDER BY valid_from DESC LIMIT 1`,
    [fromId, toId],
  );
  if (!r.rows[0]) throw new LoyaltyError("CONVERSION_NOT_FOUND", "Chưa cấu hình tỷ giá quy đổi giữa 2 loại điểm.");
  return Number(r.rows[0]!.rate);
}

export interface ConvertArgs {
  occId: string;
  fromCurrency: string; // code hoặc id
  toCurrency: string;
  points: number; // số điểm 'from' đem đổi
  idempotencyKey: string;
  reason?: string | undefined;
}
export interface ConvertResult extends LoyaltyResult {
  toPoints: number; // số điểm 'to' nhận được (floor theo tỷ giá)
}

/**
 * ĐỔI ĐIỂM giữa 2 loại (vd điểm brand -> điểm CHUNG tập đoàn) theo point_conversion. Double-entry
 * cân bằng PER currency: burn `points` ở 'from' (giảm liability from) + mint floor(points*rate) ở 'to'
 * (tăng liability to). Cấm âm số dư 'from'. toPoints = floor(points*rate) (phần dư = spread, không mint).
 */
export async function convert(pool: Pool, a: ConvertArgs): Promise<ConvertResult> {
  assertValidPoints(a.points);
  let toPoints = 0;
  const res = await runOp(
    pool,
    {
      occId: a.occId,
      idempotencyKey: a.idempotencyKey,
      type: "convert",
      fingerprint: `convert:${a.occId}:${a.fromCurrency}:${a.toCurrency}:${a.points}`,
      ...(a.reason !== undefined ? { reason: a.reason } : {}),
    },
    async (ctx) => {
      const fromId = await resolveCurrencyId(ctx.client, a.fromCurrency);
      const toId = await resolveCurrencyId(ctx.client, a.toCurrency);
      if (fromId === toId) throw new LoyaltyError("INVALID_AMOUNT", "Không thể đổi cùng một loại điểm.");
      const rate = await getConversionRate(ctx.client, fromId, toId);
      toPoints = Math.floor(a.points * rate);
      if (toPoints <= 0) throw new LoyaltyError("INVALID_AMOUNT", "Số điểm quá nhỏ để quy đổi (nhận 0).");
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: -a.points, currencyId: fromId },
        { account: acc.issued, delta: a.points, currencyId: fromId },     // giảm liability 'from'
        { account: acc.available(a.occId), delta: toPoints, currencyId: toId },
        { account: acc.issued, delta: -toPoints, currencyId: toId },       // tăng liability 'to'
      ]);
      const availFrom = await accountBalanceTx(ctx.client, acc.available(a.occId), fromId);
      if (availFrom < 0) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Không đủ điểm loại nguồn để đổi.");
    },
  );
  return { ...res, toPoints };
}

export interface AdjustArgs {
  occId: string;
  points: number;    // ± (dương = cộng bù, âm = trừ/thu hồi)
  currency?: string | undefined; // mặc định GROUP
  idempotencyKey: string;
  reason: string;    // BẮT BUỘC (audit)
}

/** Điều chỉnh thủ công (bù/thu hồi) có lý do + audit. Không được làm available âm. */
export async function adjust(pool: Pool, a: AdjustArgs): Promise<LoyaltyResult> {
  if (!Number.isSafeInteger(a.points) || a.points === 0 || Math.abs(a.points) > MAX_POINTS) {
    throw new LoyaltyError("INVALID_AMOUNT", "Số điểm điều chỉnh phải là số nguyên khác 0 trong ngưỡng an toàn.");
  }
  return runOp(
    pool,
    {
      occId: a.occId,
      idempotencyKey: a.idempotencyKey,
      type: "adjust",
      fingerprint: `adjust:${a.occId}:${a.currency ?? "GROUP"}:${a.points}`,
      reason: a.reason,
    },
    async (ctx) => {
      const cur = a.currency ? await resolveCurrencyId(ctx.client, a.currency) : await getGroupCurrencyId(ctx.client);
      // +available / -issued (cộng) hoặc -available / +issued (trừ): cân bằng.
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: a.points, currencyId: cur },
        { account: acc.issued, delta: -a.points, currencyId: cur },
      ]);
      const avail = await accountBalanceTx(ctx.client, acc.available(a.occId), cur);
      if (avail < 0) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Điều chỉnh làm số dư âm — từ chối.");
    },
  );
}

export interface TransferArgs {
  fromOccId: string;
  toOccId: string;
  points: number;
  currency?: string | undefined; // mặc định GROUP
  idempotencyKey: string;
  reason?: string | undefined;
}

/** Chuyển điểm giữa 2 khách (cùng currency). Lock theo thứ tự occ (chống deadlock). Cấm âm nguồn. */
export async function transfer(pool: Pool, a: TransferArgs): Promise<LoyaltyResult> {
  assertValidPoints(a.points);
  if (a.fromOccId === a.toOccId) throw new LoyaltyError("INVALID_AMOUNT", "Không thể chuyển cho chính mình.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock 2 occ theo thứ tự cố định (chống deadlock).
    const [lo, hi] = [a.fromOccId, a.toOccId].sort();
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${lo}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${hi}`]);

    const existing = await client.query<{ txn_id: string; fingerprint: string }>(
      "SELECT txn_id, fingerprint FROM cdp.loyalty_txn WHERE idempotency_key=$1", [a.idempotencyKey]);
    const fp = `transfer:${a.fromOccId}:${a.toOccId}:${a.currency ?? "GROUP"}:${a.points}`;
    const cur = a.currency ? await resolveCurrencyId(client, a.currency) : await getGroupCurrencyId(client);
    if (existing.rows.length > 0) {
      if (existing.rows[0]!.fingerprint !== fp) {
        throw new LoyaltyError("IDEMPOTENCY_CONFLICT", "idempotency_key đã dùng cho thao tác khác.");
      }
      const balance = await balanceTx(client, a.fromOccId, cur);
      await client.query("COMMIT");
      return { txnId: existing.rows[0]!.txn_id, balance, idempotent: true };
    }
    const ins = await client.query<{ txn_id: string }>(
      `INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint, reason)
       VALUES ($1,'transfer',$2,$3,$4) RETURNING txn_id`,
      [a.idempotencyKey, a.fromOccId, fp, a.reason ?? null],
    );
    const txnId = ins.rows[0]!.txn_id;
    await postEntries({ client, txnId }, [
      { account: acc.available(a.fromOccId), delta: -a.points, currencyId: cur },
      { account: acc.available(a.toOccId), delta: a.points, currencyId: cur },
    ]);
    const availFrom = await accountBalanceTx(client, acc.available(a.fromOccId), cur);
    if (availFrom < 0) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Không đủ điểm để chuyển.");
    const balance = await balanceTx(client, a.fromOccId, cur);
    await client.query("COMMIT");
    return { txnId, balance, idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface WalletBalance {
  currencyId: string;
  currencyCode: string;
  currencyName: string;
  kind: string;
  available: number;
  reserved: number;
}

/** Tất cả ví (đa-currency) của 1 khách — số dư per currency. */
export async function listWallets(pool: Pool, occId: string): Promise<WalletBalance[]> {
  const r = await pool.query<{
    id: string; code: string; name: string; kind: string; available: string; reserved: string;
  }>(
    `SELECT c.id, c.code, c.name, c.kind,
            COALESCE(sum(e.delta) FILTER (WHERE e.account=$1),0)::text AS available,
            COALESCE(sum(e.delta) FILTER (WHERE e.account=$2),0)::text AS reserved
       FROM cdp.point_currency c
       LEFT JOIN cdp.loyalty_entry e ON e.currency_id=c.id AND e.account IN ($1,$2)
      WHERE c.is_active
      GROUP BY c.id, c.code, c.name, c.kind
      HAVING COALESCE(sum(e.delta) FILTER (WHERE e.account=$1),0) <> 0
          OR COALESCE(sum(e.delta) FILTER (WHERE e.account=$2),0) <> 0
      ORDER BY c.kind DESC, c.code`,
    [acc.available(occId), acc.reserved(occId)],
  );
  return r.rows.map((x) => ({
    currencyId: x.id, currencyCode: x.code, currencyName: x.name, kind: x.kind,
    available: Number(x.available), reserved: Number(x.reserved),
  }));
}

export async function getBalance(pool: Pool, occId: string): Promise<LoyaltyBalance> {
  const client = await pool.connect();
  try {
    return await balanceTx(client, occId, await getGroupCurrencyId(client));
  } finally {
    client.release();
  }
}

export interface LoyaltyMember {
  occId: string;
  fullName: string | null;
  available: number;
  totalEarned: number;
}

export interface LoyaltyLedgerEntry {
  txnId: string;
  type: string;
  reason: string | null;
  pointsDelta: number;
  availableAfter: number;
  createdAt: string;
}

/**
 * Lịch sử điểm (drill-down) của MỘT thành viên: các dòng ledger trên tài khoản
 * `member:{occId}:available`, kèm số dư khả dụng luỹ kế (running-sum theo thứ tự entry).
 * Trả về mới→cũ để hiển thị; số dư sau mỗi giao dịch tính theo thứ tự thời gian tăng dần.
 */
export async function listLedger(pool: Pool, occId: string, limit = 100): Promise<LoyaltyLedgerEntry[]> {
  const account = acc.available(occId);
  const r = await pool.query<{
    txn_id: string; type: string; reason: string | null;
    points_delta: string; available_after: string; created_at: string;
  }>(
    `SELECT t.txn_id, t.type, t.reason,
            e.delta::text AS points_delta,
            SUM(e.delta) OVER (ORDER BY e.entry_id)::text AS available_after,
            e.created_at
       FROM cdp.loyalty_entry e
       JOIN cdp.loyalty_txn t ON t.txn_id = e.txn_id
      WHERE e.account = $1
        AND e.currency_id = (SELECT id FROM cdp.point_currency WHERE code='OCC_POINT')
      ORDER BY e.entry_id DESC
      LIMIT $2`,
    [account, Math.min(limit, 500)],
  );
  return r.rows.map((row) => ({
    txnId: row.txn_id,
    type: row.type,
    reason: row.reason,
    pointsDelta: Number(row.points_delta),
    availableAfter: Number(row.available_after),
    createdAt: row.created_at,
  }));
}

/** Danh sách thành viên tích điểm (leaderboard) + tổng quan — cho màn Loyalty. */
export async function listMembers(pool: Pool, limit = 30): Promise<{ members: LoyaltyMember[]; totalMembers: number; totalPoints: number }> {
  const rows = await pool.query<{ occ_id: string; full_name: string | null; available: string; earned: string | null }>(
    `SELECT cf.occ_id, p.full_name, cf.loyalty_available::text AS available,
            (SELECT COALESCE(sum(delta), 0) FROM cdp.loyalty_entry le
               WHERE le.account = 'member:' || cf.occ_id::text || ':available' AND le.delta > 0
                 AND le.currency_id = (SELECT id FROM cdp.point_currency WHERE code='OCC_POINT'))::text AS earned
       FROM cdp.customer_feature cf
       LEFT JOIN cdp.profile p ON p.occ_id = cf.occ_id
       WHERE cf.loyalty_available > 0
       ORDER BY cf.loyalty_available DESC
       LIMIT $1`,
    [Math.min(limit, 100)],
  );
  const agg = await pool.query<{ n: string; total: string | null }>(
    `SELECT count(*)::text AS n, COALESCE(sum(loyalty_available), 0)::text AS total
       FROM cdp.customer_feature WHERE loyalty_available > 0`,
  );
  return {
    members: rows.rows.map((r) => ({
      occId: r.occ_id, fullName: r.full_name, available: Number(r.available), totalEarned: Number(r.earned ?? 0),
    })),
    totalMembers: Number(agg.rows[0]?.n ?? 0),
    totalPoints: Number(agg.rows[0]?.total ?? 0),
  };
}
