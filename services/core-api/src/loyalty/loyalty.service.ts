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
  | "CONVERSION_NOT_FOUND"
  | "REWARD_NOT_FOUND"
  | "TIER_REQUIRED"
  | "OUT_OF_STOCK"
  | "VOUCHER_NOT_FOUND"
  | "VOUCHER_INVALID_STATE"
  | "VOUCHER_BRAND_MISMATCH";

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
async function getGroupCurrencyId(db: { query: PoolClient["query"] }): Promise<string> {
  if (groupCurrencyId) return groupCurrencyId;
  const r = await db.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='OCC_POINT'");
  if (!r.rows[0]) throw new Error("Chưa seed GROUP currency OCC_POINT (migration 025).");
  groupCurrencyId = r.rows[0]!.id;
  return groupCurrencyId;
}
/** Chỉ dùng cho test: xoá cache khi DB bị dựng lại. */
export function _resetLoyaltyCurrencyCache(): void {
  groupCurrencyId = null;
}

export const MAX_POINTS = 1_000_000_000; // trần an toàn, dưới Number.MAX_SAFE_INTEGER rất xa

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
  // Scope (ghi vào loyalty_txn — phục vụ auto-earn/báo cáo/liability theo brand/kênh). Optional, mặc định null.
  brandId?: string;
  storeId?: string;
  source?: string;
  refMessageId?: string;
  correlationId?: string;
  qualifying?: boolean;
  // Currency dùng cho balance TRẢ VỀ (mặc định GROUP). Thao tác đa-currency đặt để balance khớp ví.
  balanceCurrencyId?: string;
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
      const balance = await balanceTx(client, meta.occId, meta.balanceCurrencyId ?? await getGroupCurrencyId(client));
      await client.query("COMMIT");
      return { txnId: row.txn_id, balance, idempotent: true };
    }

    const ins = await client.query<{ txn_id: string }>(
      `INSERT INTO cdp.loyalty_txn
         (idempotency_key, type, occ_id, fingerprint, reason, brand_id, store_id, source, ref_message_id, correlation_id, qualifying)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING txn_id`,
      [meta.idempotencyKey, meta.type, meta.occId, meta.fingerprint, meta.reason ?? null,
       meta.brandId ?? null, meta.storeId ?? null, meta.source ?? null, meta.refMessageId ?? null,
       meta.correlationId ?? null, meta.qualifying ?? true],
    );
    const txnId = ins.rows[0]!.txn_id;

    await work({ client, txnId });

    const balance = await balanceTx(client, meta.occId, meta.balanceCurrencyId ?? await getGroupCurrencyId(client));
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
      await createLotTx(ctx.client, a.occId, cur, a.points, ctx.txnId); // lô có hạn (L2)
    },
  );
}

export interface AutoEarnArgs {
  occId: string;
  points: number;
  currencyId: string;      // tích vào loại điểm nào (brand currency / group)
  messageId: string;       // canonical_transaction.message_id (idempotency + ref)
  brandId?: string;
  storeId?: string;
  source?: string;
  qualifying: boolean;     // true = điểm tính hạng
}

/**
 * Phát hành điểm auto-earn theo rule (L3), CHẠY TRONG transaction của caller (client đã BEGIN +
 * advisory-lock occ) — atomic với việc set canonical_transaction.loyalty_earned. Idempotent qua
 * key ỔN ĐỊNH `sys:autoearn:{messageId}` (fingerprint = key, KHÔNG phụ thuộc points -> replay khi
 * rule đổi vẫn idempotent, không IDEMPOTENCY_CONFLICT). Trả điểm đã tích (0 nếu đã tích trước đó).
 */
export async function postAutoEarnTx(client: PoolClient, a: AutoEarnArgs): Promise<number> {
  assertValidPoints(a.points);
  const key = `sys:autoearn:${a.messageId}`;
  const ins = await client.query<{ txn_id: string }>(
    `INSERT INTO cdp.loyalty_txn
       (idempotency_key, type, occ_id, fingerprint, reason, brand_id, store_id, source, ref_message_id, qualifying)
     VALUES ($1,'earn',$2,$1,'auto-earn',$3,$4,$5,$6,$7)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING txn_id`,
    [key, a.occId, a.brandId ?? null, a.storeId ?? null, a.source ?? null, a.messageId, a.qualifying],
  );
  if (ins.rows.length === 0) return 0; // đã tích trước đó (idempotent)
  const txnId = ins.rows[0]!.txn_id;
  await client.query(
    `INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id)
     VALUES ($1,$2,$3::bigint,$4),($1,$5,(-$3::bigint),$4)`,
    [txnId, acc.available(a.occId), String(a.points), a.currencyId, acc.issued],
  );
  await createLotTx(client, a.occId, a.currencyId, a.points, txnId);
  return a.points;
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
      // Rời tầng available -> tiêu lô FIFO; LƯU lát đã tiêu (kèm expire_at gốc) để release TRẢ đúng
      // hạn (không reset đồng hồ đáo hạn) (L2).
      const consumed = await consumeLotsFifoTx(ctx.client, a.occId, cur, a.points);
      const r = await ctx.client.query<{ reservation_id: string }>(
        `INSERT INTO cdp.loyalty_reservation (occ_id, points, reserve_txn, consumed_lots)
         VALUES ($1,$2,$3,$4::jsonb) RETURNING reservation_id`,
        [a.occId, a.points, ctx.txnId, JSON.stringify(consumed)],
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
      const r = await ctx.client.query<{ points: string; status: string; consumed_lots: LotSlice[] }>(
        "SELECT points, status, consumed_lots FROM cdp.loyalty_reservation WHERE reservation_id=$1 FOR UPDATE",
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
      // release: điểm quay lại available -> TÁI TẠO đúng lô đã tiêu lúc reserve, BẢO TOÀN expire_at gốc
      // (không reset đồng hồ -> chống điểm bất tử; lô đã quá hạn sẽ được scheduler breakage ngay).
      // capture: available không đổi (reserved -> redeemed), lô đã tiêu vĩnh viễn nên không đụng (L2).
      if (mode === "release") await createLotsFromSlicesTx(ctx.client, occId, cur, row.consumed_lots, ctx.txnId);
      await ctx.client.query(
        "UPDATE cdp.loyalty_reservation SET status=$2, updated_at=now() WHERE reservation_id=$1",
        [a.reservationId, mode === "capture" ? "captured" : "released"],
      );
    },
  );
}

/** Số dư điểm CHUNG (group currency) của 1 khách — mặc định (tương thích ngược). */
// ── L1: đa-currency (convert / adjust / transfer) ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Queryable = { query: PoolClient["query"] };
async function resolveCurrencyId(db: Queryable, codeOrId: string): Promise<string> {
  // Phân biệt rõ uuid vs code (tránh nhập nhằng nếu code trùng dạng uuid); is_active bắt buộc.
  const sql = UUID_RE.test(codeOrId)
    ? "SELECT id FROM cdp.point_currency WHERE id::text=$1 AND is_active LIMIT 1"
    : "SELECT id FROM cdp.point_currency WHERE code=$1 AND is_active LIMIT 1";
  const r = await db.query<{ id: string }>(sql, [codeOrId]);
  if (!r.rows[0]) throw new LoyaltyError("CURRENCY_NOT_FOUND", `Loại điểm không tồn tại/không hoạt động: ${codeOrId}`);
  return r.rows[0]!.id;
}

/** Tính số điểm 'to' = floor(points * rate) HOÀN TOÀN trong SQL numeric (KHÔNG float JS) — chống sai
 *  số/precision khi nhân điểm tiền. Tỷ giá hiệu lực mới nhất, thứ tự tất định. Trả string bigint. */
async function computeConvertedPoints(db: Queryable, fromId: string, toId: string, points: number): Promise<string> {
  const r = await db.query<{ tp: string }>(
    `SELECT floor($3::numeric * rate)::bigint::text AS tp FROM cdp.point_conversion
      WHERE from_currency_id=$1 AND to_currency_id=$2
        AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
      ORDER BY valid_from DESC, created_at DESC, id DESC LIMIT 1`,
    [fromId, toId, points],
  );
  if (!r.rows[0]) throw new LoyaltyError("CONVERSION_NOT_FOUND", "Chưa cấu hình tỷ giá quy đổi giữa 2 loại điểm.");
  return r.rows[0]!.tp;
}

// ── L2: point lots (lô điểm) + expiry/breakage ──
// Lô bám tầng AVAILABLE: available(occ,cur) == Σ lô 'active'.points_remaining. Mọi thao tác TĂNG
// available -> tạo lô mới (expiry theo policy); mọi thao tác GIẢM available -> tiêu lô FIFO theo
// expire_at (hết hạn sớm trước). Bất biến này để scheduler đáo hạn tính breakage đúng.

/** Một "lát" điểm đã tiêu từ một lô: giữ expire_at gốc để tái tạo lô bảo toàn hạn (release/transfer/merge). */
export interface LotSlice { e: string | null; p: string } // e=expire_at ISO|null, p=points (string bigint)

function toBig(points: number | bigint | string): bigint {
  return typeof points === "bigint" ? points : BigInt(points);
}

/** Tạo lô điểm cho phần AVAILABLE vừa tăng; expire_at tính theo expiration_policy của currency (đồng
 *  hồ từ now). Dùng cho earn/adjust+/convert-mint (điểm MỚI). points nhận number|bigint|string (bigint-safe). */
export async function createLotTx(
  client: PoolClient, occId: string, currencyId: string, points: number | bigint | string, earnTxn: string,
): Promise<void> {
  await client.query(
    `INSERT INTO cdp.loyalty_lot (occ_id, currency_id, points_original, points_remaining, earn_txn, issuing_company_id, expire_at)
     SELECT $1,$2,$3::bigint,$3::bigint,$4,
            (SELECT company_id FROM cdp.point_currency WHERE id=$2),
            (SELECT CASE p.mode
                      WHEN 'NONE'    THEN NULL
                      WHEN 'ROLLING' THEN now() + (p.duration_months || ' months')::interval
                      WHEN 'FIXED'   THEN date_trunc('year', now() + (p.duration_months || ' months')::interval)
                                          + interval '1 year' - interval '1 second'
                    END
               FROM cdp.expiration_policy p WHERE p.currency_id=$2 AND p.is_active)`,
    [occId, currencyId, toBig(points).toString(), earnTxn],
  );
}

/** Tái tạo lô từ các lát đã tiêu, BẢO TOÀN expire_at gốc (không reset đồng hồ đáo hạn). Dùng cho
 *  release (trả điểm về available) / transfer / merge (chuyển điểm sang khách khác). */
export async function createLotsFromSlicesTx(
  client: PoolClient, occId: string, currencyId: string, slices: LotSlice[], earnTxn: string,
): Promise<void> {
  for (const s of slices) {
    if (toBig(s.p) <= 0n) continue;
    await client.query(
      `INSERT INTO cdp.loyalty_lot (occ_id, currency_id, points_original, points_remaining, earn_txn, issuing_company_id, expire_at)
       VALUES ($1,$2,$3::bigint,$3::bigint,$4,(SELECT company_id FROM cdp.point_currency WHERE id=$2),$5::timestamptz)`,
      [occId, currencyId, toBig(s.p).toString(), earnTxn, s.e],
    );
  }
}

/** Tiêu `points` từ các lô active theo FIFO (expire_at sớm trước). Cập nhật points_remaining +
 *  status='exhausted' khi cạn. Ném INSUFFICIENT_BALANCE nếu tổng lô còn hạn không đủ (bất biến vỡ).
 *  Trả về các lát đã tiêu (kèm expire_at gốc) để caller tái tạo lô bảo toàn hạn nếu cần. Bigint-safe. */
export async function consumeLotsFifoTx(
  client: PoolClient, occId: string, currencyId: string, points: number | bigint | string,
): Promise<LotSlice[]> {
  const lots = await client.query<{ lot_id: string; rem: string; expire_at: string | null }>(
    `SELECT lot_id, points_remaining::text AS rem, expire_at FROM cdp.loyalty_lot
      WHERE occ_id=$1 AND currency_id=$2 AND status='active' AND points_remaining > 0
      ORDER BY expire_at ASC NULLS LAST, created_at ASC
      FOR UPDATE`,
    [occId, currencyId],
  );
  let remaining = toBig(points);
  const consumed: LotSlice[] = [];
  for (const l of lots.rows) {
    if (remaining <= 0n) break;
    const rem = BigInt(l.rem);
    const take = rem < remaining ? rem : remaining;
    const left = rem - take;
    await client.query(
      "UPDATE cdp.loyalty_lot SET points_remaining=$2::bigint, status=CASE WHEN $2::bigint=0 THEN 'exhausted' ELSE 'active' END WHERE lot_id=$1",
      [l.lot_id, left.toString()],
    );
    consumed.push({ e: l.expire_at, p: take.toString() });
    remaining -= take;
  }
  if (remaining > 0n) {
    throw new LoyaltyError("INSUFFICIENT_BALANCE", "Không đủ lô điểm còn hạn để tiêu.");
  }
  return consumed;
}

/**
 * Scheduler đáo hạn: mọi lô active đã tới hạn (expire_at <= now, còn điểm) -> hạch toán breakage
 * (-available / +system:breakage per currency: giảm liability, ghi nhận điểm vỡ) + set lô 'expired'.
 * Idempotent theo lô (idempotency_key = expire:{lot_id}). Lock per occ. Trả số lô đã đáo hạn.
 */
export async function expireLots(pool: Pool): Promise<number> {
  const due = await pool.query<{ occ_id: string }>(
    "SELECT DISTINCT occ_id FROM cdp.loyalty_lot WHERE status='active' AND expire_at IS NOT NULL AND expire_at <= now() AND points_remaining > 0",
  );
  let count = 0;
  for (const { occ_id } of due.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${occ_id}`]);
      const lots = await client.query<{ lot_id: string; currency_id: string; rem: string }>(
        `SELECT lot_id, currency_id, points_remaining::text AS rem FROM cdp.loyalty_lot
          WHERE occ_id=$1 AND status='active' AND expire_at IS NOT NULL AND expire_at <= now() AND points_remaining > 0
          FOR UPDATE`,
        [occ_id],
      );
      for (const lot of lots.rows) {
        // Key hệ thống có namespace 'sys:' (op công khai bị cấm prefix này ở schema) -> không đụng
        // idempotency_key của user. Dedup thật sự là status='expired' + FOR UPDATE + advisory lock.
        const key = `sys:expire:${lot.lot_id}`;
        const ins = await client.query<{ txn_id: string }>(
          `INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint, reason)
           VALUES ($1,'expire',$2,$1,'point-expiry') ON CONFLICT (idempotency_key) DO NOTHING RETURNING txn_id`,
          [key, occ_id],
        );
        if (ins.rows.length === 0) continue; // đã đáo hạn trước đó (idempotent)
        await client.query(
          `INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id)
           VALUES ($1,$2,(-$3::bigint),$4),($1,$5,$3::bigint,$4)`,
          [ins.rows[0]!.txn_id, `member:${occ_id}:available`, lot.rem, lot.currency_id, "system:breakage"],
        );
        await client.query("UPDATE cdp.loyalty_lot SET points_remaining=0, status='expired' WHERE lot_id=$1", [lot.lot_id]);
        count++;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return count;
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
  // Resolve canonical + tính toPoints (SQL numeric) TRƯỚC -> fingerprint theo ID canonical (idempotency
  // ổn định dù caller dùng code hay uuid) + không nhân điểm bằng float JS.
  const fromId = await resolveCurrencyId(pool, a.fromCurrency);
  const toId = await resolveCurrencyId(pool, a.toCurrency);
  if (fromId === toId) throw new LoyaltyError("INVALID_AMOUNT", "Không thể đổi cùng một loại điểm.");
  const toPointsStr = await computeConvertedPoints(pool, fromId, toId, a.points);
  if (toPointsStr === "0" || toPointsStr.startsWith("-")) {
    throw new LoyaltyError("INVALID_AMOUNT", "Số điểm quá nhỏ để quy đổi (nhận 0).");
  }
  let toPoints = Number(toPointsStr);
  if (!Number.isSafeInteger(toPoints) || toPoints > MAX_POINTS) {
    throw new LoyaltyError("INVALID_AMOUNT", "Số điểm quy đổi vượt ngưỡng an toàn (tỷ giá/points quá lớn).");
  }

  const res = await runOp(
    pool,
    {
      occId: a.occId,
      idempotencyKey: a.idempotencyKey,
      type: "convert",
      fingerprint: `convert:${a.occId}:${fromId}:${toId}:${a.points}`,
      ...(a.reason !== undefined ? { reason: a.reason } : {}),
    },
    async (ctx) => {
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: -a.points, currencyId: fromId },
        { account: acc.issued, delta: a.points, currencyId: fromId },     // giảm liability 'from'
        { account: acc.available(a.occId), delta: toPoints, currencyId: toId },
        { account: acc.issued, delta: -toPoints, currencyId: toId },       // tăng liability 'to'
      ]);
      const availFrom = await accountBalanceTx(ctx.client, acc.available(a.occId), fromId);
      if (availFrom < 0) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Không đủ điểm loại nguồn để đổi.");
      await consumeLotsFifoTx(ctx.client, a.occId, fromId, a.points);  // burn lô 'from' FIFO (L2)
      await createLotTx(ctx.client, a.occId, toId, toPoints, ctx.txnId); // mint lô 'to' có hạn (L2)
    },
  );
  // Replay idempotent: work KHÔNG chạy -> lấy lại số điểm đã mint từ ledger của txn cũ (mint = +delta 'to').
  if (res.idempotent) {
    const r = await pool.query<{ b: string }>(
      "SELECT COALESCE(sum(delta),0)::bigint::text AS b FROM cdp.loyalty_entry WHERE txn_id=$1 AND account=$2 AND currency_id=$3 AND delta>0",
      [res.txnId, acc.available(a.occId), toId],
    );
    toPoints = Number(r.rows[0]!.b);
  }
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
  // Resolve canonical currency TRƯỚC -> fingerprint theo ID (ổn định dù code/uuid) + gồm reason
  // (replay cùng key nhưng khác lý do/currency -> IDEMPOTENCY_CONFLICT, không nuốt âm thầm).
  const cur = a.currency ? await resolveCurrencyId(pool, a.currency) : await getGroupCurrencyId(pool);
  return runOp(
    pool,
    {
      occId: a.occId,
      idempotencyKey: a.idempotencyKey,
      type: "adjust",
      fingerprint: `adjust:${a.occId}:${cur}:${a.points}:${a.reason}`,
      reason: a.reason,
    },
    async (ctx) => {
      // +available / -issued (cộng) hoặc -available / +issued (trừ): cân bằng.
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: a.points, currencyId: cur },
        { account: acc.issued, delta: -a.points, currencyId: cur },
      ]);
      const avail = await accountBalanceTx(ctx.client, acc.available(a.occId), cur);
      if (avail < 0) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Điều chỉnh làm số dư âm — từ chối.");
      // Đồng bộ lô: cộng -> lô mới; trừ -> tiêu FIFO (L2).
      if (a.points > 0) await createLotTx(ctx.client, a.occId, cur, a.points, ctx.txnId);
      else await consumeLotsFifoTx(ctx.client, a.occId, cur, -a.points);
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

    // Resolve canonical currency TRƯỚC -> fingerprint theo ID (ổn định dù code/uuid).
    const cur = a.currency ? await resolveCurrencyId(client, a.currency) : await getGroupCurrencyId(client);
    const existing = await client.query<{ txn_id: string; fingerprint: string }>(
      "SELECT txn_id, fingerprint FROM cdp.loyalty_txn WHERE idempotency_key=$1", [a.idempotencyKey]);
    const fp = `transfer:${a.fromOccId}:${a.toOccId}:${cur}:${a.points}`;
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
    // Tiêu lô người gửi (FIFO) rồi tạo lô người nhận BẢO TOÀN expire_at gốc (chuyển điểm KHÔNG gia
    // hạn tuổi thọ -> breakage đúng, chống né đáo hạn qua transfer) (L2).
    const moved = await consumeLotsFifoTx(client, a.fromOccId, cur, a.points);
    await createLotsFromSlicesTx(client, a.toOccId, cur, moved, txnId);
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
