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
  | "IDEMPOTENCY_CONFLICT";

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
      const balance = await balanceTx(client, meta.occId);
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

    const balance = await balanceTx(client, meta.occId);
    await client.query("COMMIT");
    return { txnId, balance, idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function postEntries(
  ctx: OpCtx,
  lines: Array<{ account: string; delta: number }>,
): Promise<void> {
  const sum = lines.reduce((s, l) => s + l.delta, 0);
  if (sum !== 0) throw new Error("loyalty: bút toán kép không cân (tổng delta != 0)");
  for (const line of lines) {
    await ctx.client.query(
      "INSERT INTO cdp.loyalty_entry (txn_id, account, delta) VALUES ($1,$2,$3)",
      [ctx.txnId, line.account, line.delta],
    );
  }
}

async function accountBalanceTx(client: PoolClient, account: string): Promise<number> {
  const r = await client.query<{ bal: string | null }>(
    "SELECT COALESCE(sum(delta),0)::bigint AS bal FROM cdp.loyalty_entry WHERE account=$1",
    [account],
  );
  return Number(r.rows[0]!.bal ?? 0);
}

async function balanceTx(client: PoolClient, occId: string): Promise<LoyaltyBalance> {
  const [available, reserved] = await Promise.all([
    accountBalanceTx(client, acc.available(occId)),
    accountBalanceTx(client, acc.reserved(occId)),
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
    (ctx) =>
      postEntries(ctx, [
        { account: acc.available(a.occId), delta: a.points },
        { account: acc.issued, delta: -a.points },
      ]),
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
      await postEntries(ctx, [
        { account: acc.available(a.occId), delta: -a.points },
        { account: acc.reserved(a.occId), delta: a.points },
      ]);
      const avail = await accountBalanceTx(ctx.client, acc.available(a.occId));
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
      const lines =
        mode === "capture"
          ? [
              { account: acc.reserved(occId), delta: -points },
              { account: acc.redeemed, delta: points },
            ]
          : [
              { account: acc.reserved(occId), delta: -points },
              { account: acc.available(occId), delta: points },
            ];
      await postEntries(ctx, lines);
      await ctx.client.query(
        "UPDATE cdp.loyalty_reservation SET status=$2, updated_at=now() WHERE reservation_id=$1",
        [a.reservationId, mode === "capture" ? "captured" : "released"],
      );
    },
  );
}

export async function getBalance(pool: Pool, occId: string): Promise<LoyaltyBalance> {
  const client = await pool.connect();
  try {
    return await balanceTx(client, occId);
  } finally {
    client.release();
  }
}
