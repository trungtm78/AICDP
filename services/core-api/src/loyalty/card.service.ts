import type { Pool, PoolClient } from "pg";
import { LoyaltyError, createLotTx, consumeLotsFifoTx } from "./loyalty.service.js";

// L8 — Thẻ thành viên (card/QR) + ví stored-value. Thẻ resolve khách tại POS. Stored-value dùng chính
// sổ cái double-entry (currency OCC_CASH kind STORED_VALUE): topUp nạp tiền (+available/-system:cash_in),
// pay trừ (-available/+system:cash_out), cấm âm. Authorization tại quầy = reserve->capture (kernel).

const CASH_IN = "system:cash_in";
const CASH_OUT = "system:cash_out";

export interface CardRow { id: string; occId: string; cardNo: string; qrToken: string; status: string; }
function mapCard(x: Record<string, unknown>): CardRow {
  return { id: x["id"] as string, occId: x["occ_id"] as string, cardNo: x["card_no"] as string,
    qrToken: x["qr_token"] as string, status: x["status"] as string };
}

/** Phát thẻ cho khách (số thẻ + QR token ngẫu nhiên). Trả thẻ đang active nếu đã có. */
export async function issueCard(pool: Pool, occId: string): Promise<CardRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Advisory lock per occ + partial-unique index (migration) -> 1 thẻ active/khách (chống race).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`card:${occId}`]);
    const existed = await client.query<Record<string, unknown>>(
      "SELECT * FROM cdp.member_card WHERE occ_id=$1 AND status='active' ORDER BY issued_at DESC LIMIT 1", [occId]);
    if (existed.rows[0]) { await client.query("COMMIT"); return mapCard(existed.rows[0]!); }
    const r = await client.query<Record<string, unknown>>(
      `INSERT INTO cdp.member_card (occ_id, card_no, qr_token)
       VALUES ($1, 'C'||to_char(now(),'YYMM')||upper(substr(md5(gen_random_uuid()::text),1,10)),
               encode(gen_random_bytes(16),'hex')) RETURNING *`, [occId]);
    await client.query("COMMIT");
    return mapCard(r.rows[0]!);
  } catch (err) { await client.query("ROLLBACK"); throw err; } finally { client.release(); }
}

/** Resolve khách tại POS theo số thẻ HOẶC QR token (thẻ active). Match TỪNG cột (card_no trước, rồi
 *  qr_token) -> tránh nhập nhằng chéo cột nếu dữ liệu import trùng định dạng. */
export async function resolveByCard(pool: Pool, cardNoOrToken: string): Promise<CardRow | null> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT * FROM cdp.member_card WHERE status='active' AND card_no=$1
     UNION ALL SELECT * FROM cdp.member_card WHERE status='active' AND qr_token=$1 AND card_no<>$1
     LIMIT 1`, [cardNoOrToken]);
  return r.rows[0] ? mapCard(r.rows[0]!) : null;
}

/** Khóa thẻ (mất/thu hồi) — thẻ bị khóa không resolve được. */
export async function blockCard(pool: Pool, cardNo: string, status: "blocked" | "lost" = "blocked"): Promise<void> {
  const r = await pool.query("UPDATE cdp.member_card SET status=$2, updated_at=now() WHERE card_no=$1 AND status='active'", [cardNo, status]);
  if (r.rowCount === 0) throw new LoyaltyError("REWARD_NOT_FOUND", "Thẻ không tồn tại/đã khóa.");
}

async function cashCurrencyId(client: PoolClient): Promise<string> {
  const r = await client.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='OCC_CASH'");
  if (!r.rows[0]) throw new Error("Chưa seed STORED_VALUE currency OCC_CASH (migration 032).");
  return r.rows[0]!.id;
}
async function cashBalance(client: PoolClient, occId: string, curId: string): Promise<bigint> {
  const r = await client.query<{ b: string }>(
    "SELECT COALESCE(sum(delta),0)::bigint::text AS b FROM cdp.loyalty_entry WHERE account=$1 AND currency_id=$2",
    [`member:${occId}:available`, curId]);
  return BigInt(r.rows[0]!.b);
}

export interface StoredValueResult { txnId: string; balance: number; idempotent: boolean; }

/** Nạp tiền vào ví stored-value (từ thanh toán ngoài). +available OCC_CASH / -cash_in. Idempotent. */
export async function topUp(pool: Pool, occId: string, amount: number, idempotencyKey: string): Promise<StoredValueResult> {
  return storedValueOp(pool, occId, amount, idempotencyKey, "topup");
}
/** Chi tiêu từ ví stored-value tại quầy. -available / +cash_out. Cấm âm. Idempotent. */
export async function payWithStoredValue(pool: Pool, occId: string, amount: number, idempotencyKey: string): Promise<StoredValueResult> {
  return storedValueOp(pool, occId, amount, idempotencyKey, "pay");
}

async function storedValueOp(pool: Pool, occId: string, amount: number, idempotencyKey: string, mode: "topup" | "pay"): Promise<StoredValueResult> {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new LoyaltyError("INVALID_AMOUNT", "Số tiền phải là số nguyên dương.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${occId}`]);
    const curId = await cashCurrencyId(client);
    const fp = `storedvalue:${mode}:${occId}:${amount}`;
    const existed = await client.query<{ txn_id: string; fingerprint: string }>(
      "SELECT txn_id, fingerprint FROM cdp.loyalty_txn WHERE idempotency_key=$1", [idempotencyKey]);
    if (existed.rows[0]) {
      if (existed.rows[0]!.fingerprint !== fp) throw new LoyaltyError("IDEMPOTENCY_CONFLICT", "idempotency_key đã dùng cho thao tác khác.");
      const bal = await cashBalance(client, occId, curId);
      await client.query("COMMIT");
      return { txnId: existed.rows[0]!.txn_id, balance: Number(bal), idempotent: true };
    }
    const ins = await client.query<{ txn_id: string }>(
      `INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint, reason) VALUES ($1,$2,$3,$4,$5) RETURNING txn_id`,
      [idempotencyKey, mode === "topup" ? "sv_topup" : "sv_pay", occId, fp, mode === "topup" ? "stored-value top-up" : "stored-value pay"]);
    const txnId = ins.rows[0]!.txn_id;
    if (mode === "topup") {
      await client.query(
        `INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,$3::bigint,$4),($1,$5,(-$3::bigint),$4)`,
        [txnId, `member:${occId}:available`, String(amount), curId, CASH_IN]);
      await createLotTx(client, occId, curId, amount, txnId); // lô stored-value (expire NULL, không đáo hạn)
    } else {
      await client.query(
        `INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,(-$3::bigint),$4),($1,$5,$3::bigint,$4)`,
        [txnId, `member:${occId}:available`, String(amount), curId, CASH_OUT]);
      const bal = await cashBalance(client, occId, curId);
      if (bal < 0n) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Số dư ví không đủ.");
      await consumeLotsFifoTx(client, occId, curId, amount); // đồng bộ lô stored-value
    }
    const bal = await cashBalance(client, occId, curId);
    await client.query("COMMIT");
    return { txnId, balance: Number(bal), idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    // Race cross-member cùng idempotencyKey -> unique violation loyalty_txn -> lỗi nghiệp vụ sạch.
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      throw new LoyaltyError("IDEMPOTENCY_CONFLICT", "idempotency_key đã dùng cho thao tác khác.");
    }
    throw err;
  } finally { client.release(); }
}

/** Số dư ví stored-value (VND). */
export async function storedValueBalance(pool: Pool, occId: string): Promise<number> {
  const client = await pool.connect();
  try {
    const curId = await cashCurrencyId(client);
    return Number(await cashBalance(client, occId, curId));
  } finally { client.release(); }
}
