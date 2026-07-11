import type { Pool, PoolClient } from "pg";
import { LoyaltyError, consumeLotsFifoTx } from "./loyalty.service.js";
import { recordSettlementForRedeemTx } from "./liability.service.js";

// L5 — Reward catalog + redemption cross-brand. Đổi điểm CHUNG (OCC_POINT) lấy reward -> tiêu ở BRAND
// bất kỳ. Redeem = burn điểm ATOMIC (available -> redeemed, giống capture) + phát voucher, trong MỘT
// transaction (advisory-lock occ) -> không mất điểm nếu phát voucher lỗi. Voucher FIXED tiêu partial.

export interface RewardItem {
  id: string; code: string; name: string; type: string; costPoints: number;
  currencyId: string; currencyCode: string; redeemableAtBrandId: string | null;
  tierMinLevel: number | null; valueType: string | null; value: number | null;
  validityDays: number; stock: number | null; isActive: boolean;
}
export interface VoucherRow {
  id: string; code: string; rewardItemId: string; state: string; valueType: string | null;
  value: number | null; remainingValue: number | null; redeemableAtBrandId: string | null;
  issuedAt: string; expireAt: string | null; redeemedAt: string | null;
}
export interface RedeemResult {
  txnId: string; voucherId: string | null; voucherCode: string | null;
  costPoints: number; balanceAvailable: number; idempotent: boolean;
}

function mapReward(x: Record<string, unknown>): RewardItem {
  return {
    id: x["id"] as string, code: x["code"] as string, name: x["name"] as string, type: x["type"] as string,
    costPoints: Number(x["cost_points"]), currencyId: x["currency_id"] as string, currencyCode: x["currency_code"] as string,
    redeemableAtBrandId: (x["redeemable_at_brand_id"] as string) ?? null,
    tierMinLevel: x["tier_min_level"] == null ? null : Number(x["tier_min_level"]),
    valueType: (x["value_type"] as string) ?? null, value: x["value"] == null ? null : Number(x["value"]),
    validityDays: Number(x["validity_days"]), stock: x["stock"] == null ? null : Number(x["stock"]),
    isActive: x["is_active"] as boolean,
  };
}

/** Danh mục reward đang phát hành (active + trong cửa sổ). */
export async function listRewards(pool: Pool): Promise<RewardItem[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT ri.*, c.code AS currency_code FROM cdp.reward_catalog_item ri
       JOIN cdp.point_currency c ON c.id=ri.currency_id
      WHERE ri.is_active AND (ri.valid_from IS NULL OR ri.valid_from <= now())
        AND (ri.valid_to IS NULL OR ri.valid_to > now())
      ORDER BY ri.cost_points`);
  return r.rows.map(mapReward);
}

/** Voucher của một khách. */
export async function listMemberVouchers(pool: Pool, occId: string): Promise<VoucherRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM cdp.voucher WHERE occ_id=$1 ORDER BY issued_at DESC", [occId]);
  return r.rows.map(mapVoucher);
}
function mapVoucher(x: Record<string, unknown>): VoucherRow {
  return {
    id: x["id"] as string, code: x["code"] as string, rewardItemId: x["reward_item_id"] as string,
    state: x["state"] as string, valueType: (x["value_type"] as string) ?? null,
    value: x["value"] == null ? null : Number(x["value"]),
    remainingValue: x["remaining_value"] == null ? null : Number(x["remaining_value"]),
    redeemableAtBrandId: (x["redeemable_at_brand_id"] as string) ?? null,
    issuedAt: String(x["issued_at"]), expireAt: x["expire_at"] ? String(x["expire_at"]) : null,
    redeemedAt: x["redeemed_at"] ? String(x["redeemed_at"]) : null,
  };
}

export interface RedeemArgs { occId: string; rewardCode: string; idempotencyKey: string; }

/**
 * ĐỔI điểm lấy reward: burn cost_points (available -> redeemed) + phát voucher (nếu type VOUCHER),
 * ATOMIC. Kiểm hạng tối thiểu + tồn kho + số dư. Idempotent theo idempotencyKey. Điểm burn ở currency
 * của reward (thường GROUP -> cross-brand). Cross-brand: voucher redeemable_at_brand NULL = mọi brand.
 */
export async function redeemReward(pool: Pool, a: RedeemArgs): Promise<RedeemResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${a.occId}`]);

    // Idempotent replay theo key — TRẢ KẾT QUẢ CŨ TRƯỚC, KHÔNG re-validate reward (reward có thể đã
    // tắt/đổi cost sau lần đổi đầu; retry hợp lệ vẫn phải trả voucher đã phát, không burn lần 2).
    const existed = await client.query<{ txn_id: string; fingerprint: string; occ_id: string }>(
      "SELECT txn_id, fingerprint, occ_id FROM cdp.loyalty_txn WHERE idempotency_key=$1", [a.idempotencyKey]);
    if (existed.rows[0]) {
      if (!existed.rows[0]!.fingerprint.startsWith("redeem:") || existed.rows[0]!.occ_id !== a.occId) {
        throw new LoyaltyError("IDEMPOTENCY_CONFLICT", "idempotency_key đã dùng cho thao tác khác.");
      }
      const txnId = existed.rows[0]!.txn_id;
      const v = await client.query<{ id: string; code: string }>(
        "SELECT id, code FROM cdp.voucher WHERE redeem_txn=$1", [txnId]);
      // costPoints + currency lấy TỪ LEDGER của txn cũ (không phụ thuộc reward hiện tại).
      const burn = await client.query<{ cost: string; cur: string }>(
        `SELECT (-sum(delta))::bigint::text AS cost, currency_id AS cur FROM cdp.loyalty_entry
          WHERE txn_id=$1 AND account=$2 AND delta<0 GROUP BY currency_id`,
        [txnId, `member:${a.occId}:available`]);
      const bal = burn.rows[0] ? Number(await availBal(client, a.occId, burn.rows[0]!.cur)) : 0;
      await client.query("COMMIT");
      return {
        txnId, voucherId: v.rows[0]?.id ?? null, voucherCode: v.rows[0]?.code ?? null,
        costPoints: burn.rows[0] ? Number(burn.rows[0]!.cost) : 0, balanceAvailable: bal, idempotent: true,
      };
    }

    // MỚI: load reward (active + trong cửa sổ) + khóa row (serialize stock/oversell cross-occ).
    const rewardR = await client.query<Record<string, unknown>>(
      `SELECT ri.*, c.code AS currency_code FROM cdp.reward_catalog_item ri
         JOIN cdp.point_currency c ON c.id=ri.currency_id
        WHERE ri.code=$1 AND ri.is_active
          AND (ri.valid_from IS NULL OR ri.valid_from <= now())
          AND (ri.valid_to IS NULL OR ri.valid_to > now())
        FOR UPDATE`, [a.rewardCode]);
    if (!rewardR.rows[0]) throw new LoyaltyError("REWARD_NOT_FOUND", "Reward không tồn tại/không phát hành.");
    const reward = mapReward(rewardR.rows[0]!);
    const fp = `redeem:${a.occId}:${reward.id}:${reward.costPoints}`;

    // Kiểm hạng tối thiểu.
    if (reward.tierMinLevel != null) {
      const lvl = await client.query<{ m: number | null }>(
        `SELECT max(t.level) AS m FROM cdp.member_tier mt JOIN cdp.tier t ON t.id=mt.tier_id WHERE mt.occ_id=$1`, [a.occId]);
      if ((lvl.rows[0]?.m ?? -1) < reward.tierMinLevel) {
        throw new LoyaltyError("TIER_REQUIRED", `Reward yêu cầu hạng tối thiểu (level ${reward.tierMinLevel}).`);
      }
    }
    // cost_points giữ dạng STRING bigint (pg trả bigint là text) -> không mất precision >2^53.
    const costStr = String(rewardR.rows[0]!["cost_points"]);
    // Số dư (so BigInt) — kiểm TRƯỚC khi giảm tồn kho (tránh churn/rollback tồn kho khi thiếu điểm).
    const availStr = await availBal(client, a.occId, reward.currencyId);
    if (BigInt(availStr) < BigInt(costStr)) throw new LoyaltyError("INSUFFICIENT_BALANCE", "Không đủ điểm để đổi reward.");
    // Tồn kho (giảm có điều kiện; NULL = vô hạn). Row reward đã FOR UPDATE -> serialize cross-occ.
    if (reward.stock != null) {
      const dec = await client.query(
        "UPDATE cdp.reward_catalog_item SET stock=stock-1 WHERE id=$1 AND stock>0", [reward.id]);
      if (dec.rowCount === 0) throw new LoyaltyError("OUT_OF_STOCK", "Reward đã hết tồn kho.");
    }

    // Burn atomic: available -cost / redeemed +cost (giống capture) + tiêu lô FIFO.
    const ins = await client.query<{ txn_id: string }>(
      `INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint, reason)
       VALUES ($1,'redeem',$2,$3,$4) RETURNING txn_id`,
      [a.idempotencyKey, a.occId, fp, `redeem:${reward.code}`]);
    const txnId = ins.rows[0]!.txn_id;
    await client.query(
      `INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id)
       VALUES ($1,$2,(-$3::bigint),$4),($1,'system:redeemed',$3::bigint,$4)`,
      [txnId, `member:${a.occId}:available`, costStr, reward.currencyId]);
    const burned = await consumeLotsFifoTx(client, a.occId, reward.currencyId, costStr);
    // Settlement (L7): cty nơi tiêu = cty của brand reward (nếu có), else coalition (null). Điểm burn
    // thuộc cty phát hành khác -> ghi nghĩa vụ bù trừ inter-company.
    const redeemingCompanyId = reward.redeemableAtBrandId
      ? (await client.query<{ cid: string | null }>("SELECT company_id AS cid FROM cdp.brand WHERE brand_id=$1", [reward.redeemableAtBrandId])).rows[0]?.cid ?? null
      : null;
    await recordSettlementForRedeemTx(client, { redeemTxnId: txnId, slices: burned, redeemingCompanyId, currencyId: reward.currencyId });

    // Phát voucher (type VOUCHER). Các type khác (GIFT/PAY_WITH_POINTS/PARTNER): chỉ burn điểm.
    let voucherId: string | null = null, voucherCode: string | null = null;
    if (reward.type === "VOUCHER") {
      const vr = await client.query<{ id: string; code: string }>(
        `INSERT INTO cdp.voucher (code, occ_id, reward_item_id, redeem_txn, value_type, value,
           remaining_value, redeemable_at_brand_id, expire_at)
         VALUES ('V'||upper(substr(md5(gen_random_uuid()::text),1,10)), $1,$2,$3,$4::text,$5::numeric,
                 CASE WHEN $4::text='FIXED' THEN $5::numeric ELSE NULL END, $6::text, now() + make_interval(days => $7::int))
         RETURNING id, code`,
        [a.occId, reward.id, txnId, reward.valueType, reward.value, reward.redeemableAtBrandId, reward.validityDays]);
      voucherId = vr.rows[0]!.id; voucherCode = vr.rows[0]!.code;
    }
    const bal = await availBal(client, a.occId, reward.currencyId);
    await client.query("COMMIT");
    return { txnId, voucherId, voucherCode, costPoints: Number(costStr), balanceAvailable: Number(bal), idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function availBal(client: PoolClient, occId: string, currencyId: string): Promise<string> {
  const r = await client.query<{ b: string }>(
    "SELECT COALESCE(sum(delta),0)::bigint::text AS b FROM cdp.loyalty_entry WHERE account=$1 AND currency_id=$2",
    [`member:${occId}:available`, currencyId]);
  return r.rows[0]!.b;
}

export interface UseVoucherArgs { voucherCode: string; brandId: string; amount?: number | undefined; idempotencyKey: string; }
export interface UseVoucherResult { voucherId: string; state: string; applied: number; remainingValue: number | null; idempotent: boolean; }

/**
 * DÙNG voucher tại một brand. Cross-brand: redeemable_at_brand NULL = mọi brand, ngược lại phải khớp.
 * FIXED tiêu MỘT PHẦN (amount <= remaining_value); hết -> state redeemed. PERCENT/PRODUCT dùng 1 lần.
 * Idempotent theo idempotencyKey (voucher_redemption.idempotency_key unique).
 */
export async function useVoucher(pool: Pool, a: UseVoucherArgs): Promise<UseVoucherResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lấy voucher + cờ hết hạn theo GIỜ DB (không dùng Date.now app). remaining giữ dạng text (numeric).
    const vr = await client.query<{
      id: string; state: string; value_type: string | null; value: string | null;
      rem: string | null; brand: string | null; is_expired: boolean;
    }>(
      `SELECT id, state, value_type, value::text AS value, remaining_value::text AS rem,
              redeemable_at_brand_id AS brand,
              (expire_at IS NOT NULL AND expire_at <= now()) AS is_expired
         FROM cdp.voucher WHERE code=$1 FOR UPDATE`, [a.voucherCode]);
    if (!vr.rows[0]) throw new LoyaltyError("VOUCHER_NOT_FOUND", "Voucher không tồn tại.");
    const v = vr.rows[0]!;

    // Idempotent replay — SCOPE theo voucher (key trùng cho voucher KHÁC -> fail-closed CONFLICT,
    // không trả success giả -> chống double-benefit).
    const dup = await client.query<{ amount: string; voucher_id: string }>(
      "SELECT amount::text AS amount, voucher_id FROM cdp.voucher_redemption WHERE idempotency_key=$1", [a.idempotencyKey]);
    if (dup.rows[0]) {
      if (dup.rows[0]!.voucher_id !== v.id) {
        throw new LoyaltyError("IDEMPOTENCY_CONFLICT", "idempotency_key đã dùng cho voucher khác.");
      }
      const cur = await client.query<{ state: string; remaining_value: string | null }>(
        "SELECT state, remaining_value::text AS remaining_value FROM cdp.voucher WHERE id=$1", [v.id]);
      await client.query("COMMIT");
      return { voucherId: v.id, state: cur.rows[0]!.state, applied: Number(dup.rows[0]!.amount),
        remainingValue: cur.rows[0]!.remaining_value == null ? null : Number(cur.rows[0]!.remaining_value), idempotent: true };
    }
    if (v.state !== "active") throw new LoyaltyError("VOUCHER_INVALID_STATE", `Voucher đang ở trạng thái '${v.state}'.`);
    if (v.is_expired) throw new LoyaltyError("VOUCHER_INVALID_STATE", "Voucher đã hết hạn."); // scheduler set 'expired' sau
    if (v.brand && v.brand !== a.brandId) {
      throw new LoyaltyError("VOUCHER_BRAND_MISMATCH", "Voucher không dùng được ở thương hiệu này.");
    }
    // brand phải tồn tại (đối soát liability/doanh thu theo thương hiệu chính xác).
    const bexists = await client.query("SELECT 1 FROM cdp.brand WHERE brand_id=$1", [a.brandId]);
    if (bexists.rowCount === 0) throw new LoyaltyError("VOUCHER_BRAND_MISMATCH", "Thương hiệu không tồn tại.");

    let appliedStr: string, remaining: number | null, newState: string;
    if (v.value_type === "FIXED") {
      const remStr = v.rem ?? "0";
      appliedStr = a.amount != null ? String(a.amount) : remStr; // mặc định tiêu hết phần còn lại
      if (!(Number(appliedStr) > 0)) throw new LoyaltyError("INVALID_AMOUNT", "Số tiền áp voucher phải > 0.");
      // Trừ trong SQL bằng numeric (KHÔNG float JS) + guard remaining_value >= amount (chống âm/vượt).
      const upd = await client.query<{ rem: string; state: string }>(
        `UPDATE cdp.voucher
            SET remaining_value = remaining_value - $2::numeric,
                state = CASE WHEN remaining_value - $2::numeric <= 0 THEN 'redeemed' ELSE 'active' END,
                redeemed_at = CASE WHEN remaining_value - $2::numeric <= 0 THEN now() ELSE redeemed_at END
          WHERE id=$1 AND remaining_value >= $2::numeric
        RETURNING remaining_value::text AS rem, state`,
        [v.id, appliedStr]);
      if (upd.rowCount === 0) throw new LoyaltyError("INVALID_AMOUNT", "Số tiền áp voucher vượt số dư voucher.");
      remaining = Number(upd.rows[0]!.rem);
      newState = upd.rows[0]!.state;
    } else {
      // PERCENT/PRODUCT: dùng 1 lần.
      appliedStr = v.value ?? "0"; remaining = null; newState = "redeemed";
      await client.query("UPDATE cdp.voucher SET state='redeemed', redeemed_at=now() WHERE id=$1", [v.id]);
    }
    await client.query(
      `INSERT INTO cdp.voucher_redemption (voucher_id, brand_id, amount, idempotency_key) VALUES ($1,$2,$3::numeric,$4)`,
      [v.id, a.brandId, appliedStr, a.idempotencyKey]);
    await client.query("COMMIT");
    return { voucherId: v.id, state: newState, applied: Number(appliedStr), remainingValue: remaining, idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Đáo hạn voucher active quá hạn -> state expired. Trả số voucher đã hết hạn. */
export async function expireVouchers(pool: Pool): Promise<number> {
  const r = await pool.query(
    "UPDATE cdp.voucher SET state='expired' WHERE state='active' AND expire_at IS NOT NULL AND expire_at <= now()");
  return r.rowCount ?? 0;
}
