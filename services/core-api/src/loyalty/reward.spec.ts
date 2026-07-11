import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { earn, getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import { recomputeMemberTier } from "./tier.service.js";
import { listRewards, redeemReward, listMemberVouchers, useVoucher, expireVouchers } from "./reward.service.js";

let occId: string;
let groupId: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
  groupId = (await pool.query<{ id: string }>("SELECT id FROM cdp.tier_group WHERE code='OCC_TIER'")).rows[0]!.id;
});

describe("L5 — reward catalog + redeem (burn điểm + phát voucher)", () => {
  it("đổi VOUCHER_50K (500 điểm) -> burn 500, phát voucher FIXED remaining=50000; idempotent", async () => {
    await earn(pool, { occId, points: 600, idempotencyKey: "e1" });
    const rewards = await listRewards(pool);
    expect(rewards.some((r) => r.code === "VOUCHER_50K")).toBe(true);
    const r = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    expect(r.costPoints).toBe(500);
    expect(r.voucherCode).toBeTruthy();
    expect(r.balanceAvailable).toBe(100);
    expect((await getBalance(pool, occId)).available).toBe(100);
    const vs = await listMemberVouchers(pool, occId);
    expect(vs.length).toBe(1);
    expect(vs[0]!.remainingValue).toBe(50000);
    expect(vs[0]!.state).toBe("active");
    // idempotent
    const again = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    expect(again.idempotent).toBe(true);
    expect(again.voucherCode).toBe(r.voucherCode);
    expect((await getBalance(pool, occId)).available).toBe(100); // không burn trùng
  });

  it("không đủ điểm -> INSUFFICIENT_BALANCE, không burn/không phát voucher", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await expect(redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect((await getBalance(pool, occId)).available).toBe(100);
    expect((await listMemberVouchers(pool, occId)).length).toBe(0);
  });

  it("reward yêu cầu hạng (VOUCHER_10PCT tier_min 2=Gold): chưa đủ hạng -> TIER_REQUIRED", async () => {
    await earn(pool, { occId, points: 1000, idempotencyKey: "e1" });
    await expect(redeemReward(pool, { occId, rewardCode: "VOUCHER_10PCT", idempotencyKey: "rd1" }))
      .rejects.toMatchObject({ code: "TIER_REQUIRED" });
    // nâng lên Gold rồi đổi được
    await pool.query(
      `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, source, pos_transaction_id, total, occ_timestamp)
       VALUES ('t1',$1,'givral','pos','p1',60000000,now())`, [occId]);
    await recomputeMemberTier(pool, occId, groupId); // Gold
    const r = await redeemReward(pool, { occId, rewardCode: "VOUCHER_10PCT", idempotencyKey: "rd2" });
    expect(r.costPoints).toBe(300);
  });
});

describe("L5 — dùng voucher cross-brand (partial cho FIXED)", () => {
  it("voucher 50k (mọi brand): tiêu partial 30k tại brand khác -> còn 20k; hết -> redeemed", async () => {
    await earn(pool, { occId, points: 600, idempotencyKey: "e1" });
    const rd = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    const code = rd.voucherCode!;
    const u1 = await useVoucher(pool, { voucherCode: code, brandId: "fuji", amount: 30000, idempotencyKey: "u1" });
    expect(u1.applied).toBe(30000);
    expect(u1.remainingValue).toBe(20000);
    expect(u1.state).toBe("active");
    const u2 = await useVoucher(pool, { voucherCode: code, brandId: "kem_trang_tien", amount: 20000, idempotencyKey: "u2" });
    expect(u2.remainingValue).toBe(0);
    expect(u2.state).toBe("redeemed");
    // dùng tiếp -> INVALID state
    await expect(useVoucher(pool, { voucherCode: code, brandId: "fuji", amount: 1000, idempotencyKey: "u3" }))
      .rejects.toMatchObject({ code: "VOUCHER_INVALID_STATE" });
  });

  it("tiêu quá số dư voucher -> INVALID_AMOUNT; idempotent replay dùng lại kết quả", async () => {
    await earn(pool, { occId, points: 600, idempotencyKey: "e1" });
    const rd = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    const code = rd.voucherCode!;
    await expect(useVoucher(pool, { voucherCode: code, brandId: "fuji", amount: 999999, idempotencyKey: "u1" }))
      .rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    const u = await useVoucher(pool, { voucherCode: code, brandId: "fuji", amount: 10000, idempotencyKey: "u2" });
    const again = await useVoucher(pool, { voucherCode: code, brandId: "fuji", amount: 10000, idempotencyKey: "u2" });
    expect(again.idempotent).toBe(true);
    expect(again.applied).toBe(10000);
    // không trừ 2 lần
    const vs = await listMemberVouchers(pool, occId);
    expect(vs[0]!.remainingValue).toBe(40000);
    expect(u.remainingValue).toBe(40000);
  });

  it("redeem replay SAU KHI reward bị tắt/đổi -> vẫn trả voucher cũ (không lỗi, không burn kép)", async () => {
    await earn(pool, { occId, points: 600, idempotencyKey: "e1" });
    const r1 = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    await pool.query("UPDATE cdp.reward_catalog_item SET is_active=false WHERE code='VOUCHER_50K'");
    try {
      const r2 = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
      expect(r2.idempotent).toBe(true);
      expect(r2.voucherCode).toBe(r1.voucherCode);
      expect(r2.costPoints).toBe(500);
      expect((await getBalance(pool, occId)).available).toBe(100); // không burn lần 2
    } finally {
      await pool.query("UPDATE cdp.reward_catalog_item SET is_active=true WHERE code='VOUCHER_50K'");
    }
  });

  it("useVoucher: key trùng cho voucher KHÁC -> IDEMPOTENCY_CONFLICT (chống double-benefit)", async () => {
    await earn(pool, { occId, points: 1200, idempotencyKey: "e1" });
    const a = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    const b = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd2" });
    await useVoucher(pool, { voucherCode: a.voucherCode!, brandId: "fuji", amount: 10000, idempotencyKey: "k1" });
    await expect(useVoucher(pool, { voucherCode: b.voucherCode!, brandId: "fuji", amount: 10000, idempotencyKey: "k1" }))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("useVoucher: brand không tồn tại -> VOUCHER_BRAND_MISMATCH", async () => {
    await earn(pool, { occId, points: 600, idempotencyKey: "e1" });
    const rd = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    await expect(useVoucher(pool, { voucherCode: rd.voucherCode!, brandId: "brand_khong_ton_tai", amount: 1000, idempotencyKey: "k1" }))
      .rejects.toMatchObject({ code: "VOUCHER_BRAND_MISMATCH" });
  });

  it("expireVouchers: voucher quá hạn -> state expired, không dùng được", async () => {
    await earn(pool, { occId, points: 600, idempotencyKey: "e1" });
    const rd = await redeemReward(pool, { occId, rewardCode: "VOUCHER_50K", idempotencyKey: "rd1" });
    await pool.query("UPDATE cdp.voucher SET expire_at=now()-interval '1 day' WHERE code=$1", [rd.voucherCode]);
    const n = await expireVouchers(pool);
    expect(n).toBeGreaterThanOrEqual(1);
    await expect(useVoucher(pool, { voucherCode: rd.voucherCode!, brandId: "fuji", amount: 1000, idempotencyKey: "u1" }))
      .rejects.toMatchObject({ code: "VOUCHER_INVALID_STATE" });
  });
});
