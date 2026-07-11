import { Controller, Post, Get, Body, Query, Inject, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import {
  loyaltyEarnSchema,
  loyaltyReserveSchema,
  loyaltyReservationOpSchema,
  loyaltyBalanceQuerySchema,
  loyaltyConvertSchema,
  loyaltyAdjustSchema,
  loyaltyTransferSchema,
  earnRuleSchema,
  rewardRedeemSchema,
  voucherUseSchema,
  referralCreateSchema,
  referralJoinSchema,
  cardIssueSchema,
  cardBlockSchema,
  storedValueSchema,
} from "./schemas.js";
import { earn, reserve, capture, release, getBalance, listMembers, listLedger, convert, adjust, transfer, listWallets } from "../loyalty/loyalty.service.js";
import { setEarnRule, listEarnRules, listEarnRuleAudit, processUnearnedTransactions } from "../loyalty/earn-rule.service.js";
import { listTierGroups, listTiers, getMemberTiers, recomputeMemberTier, recomputeAllTiers } from "../loyalty/tier.service.js";
import { listRewards, redeemReward, listMemberVouchers, useVoucher } from "../loyalty/reward.service.js";
import { listChallenges, getMemberProgress, createReferralCode, joinReferral } from "../loyalty/campaign.service.js";
import { computeLiabilitySnapshot, getLatestLiability, getSettlementReport, setPointPrice } from "../loyalty/liability.service.js";
import { issueCard, resolveByCard, blockCard, topUp, payWithStoredValue, storedValueBalance } from "../loyalty/card.service.js";
import { Roles } from "./auth/roles.js";
import type { AuthContext } from "./auth/roles.js";

/** Loyalty double-entry: earn + reserve/capture/release (theo reservationId) + balance. */
@Roles("csr", "analyst", "loyalty_ops", "loyalty_manager")
@Controller("v1/loyalty")
export class LoyaltyController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Roles("csr", "loyalty_ops")
  @Post("earn")
  async earn(@Body() body: unknown) {
    const dto = validate(loyaltyEarnSchema, body, "loyalty_earn");
    return {
      data: await earn(this.pool, {
        occId: dto.occId,
        points: dto.points,
        idempotencyKey: dto.idempotencyKey,
        ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      }),
    };
  }

  @Roles("csr", "loyalty_ops")
  @Post("reserve")
  async reserve(@Body() body: unknown) {
    const dto = validate(loyaltyReserveSchema, body, "loyalty_reserve");
    return { data: await reserve(this.pool, dto) };
  }

  @Roles("csr", "loyalty_ops")
  @Post("capture")
  async capture(@Body() body: unknown) {
    const dto = validate(loyaltyReservationOpSchema, body, "loyalty_capture");
    return { data: await capture(this.pool, dto) };
  }

  @Roles("csr", "loyalty_ops")
  @Post("release")
  async release(@Body() body: unknown) {
    const dto = validate(loyaltyReservationOpSchema, body, "loyalty_release");
    return { data: await release(this.pool, dto) };
  }

  @Get("balance")
  async balance(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_balance");
    return { data: await getBalance(this.pool, occId) };
  }

  /** Đổi điểm giữa 2 loại (brand -> điểm CHUNG tập đoàn) theo tỷ giá. */
  @Roles("csr", "loyalty_ops")
  @Post("convert")
  async convert(@Body() body: unknown) {
    const dto = validate(loyaltyConvertSchema, body, "loyalty_convert");
    return { data: await convert(this.pool, dto) };
  }

  /** Điều chỉnh thủ công (bù/thu hồi) — cần data_steward (nhạy cảm, có audit). */
  @Roles("data_steward", "loyalty_manager")
  @Post("adjust")
  async adjust(@Body() body: unknown) {
    const dto = validate(loyaltyAdjustSchema, body, "loyalty_adjust");
    return { data: await adjust(this.pool, dto) };
  }

  /** Chuyển điểm giữa 2 khách (cùng loại điểm). */
  @Roles("csr", "loyalty_ops")
  @Post("transfer")
  async transfer(@Body() body: unknown) {
    const dto = validate(loyaltyTransferSchema, body, "loyalty_transfer");
    return { data: await transfer(this.pool, dto) };
  }

  /** Tất cả ví (đa-currency) của 1 khách. */
  @Get("wallets")
  async wallets(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_wallets");
    return { data: await listWallets(this.pool, occId) };
  }

  @Get("members")
  async members() {
    const res = await listMembers(this.pool);
    return { data: res.members, meta: { total: res.totalMembers, totalPoints: res.totalPoints } };
  }

  /** Drill-down: lịch sử điểm của một thành viên (dòng ledger + số dư luỹ kế). */
  @Get("ledger")
  async ledger(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_ledger");
    return { data: await listLedger(this.pool, occId) };
  }

  // ── L3: earn rule engine (no-code) + auto-earn ──

  /** Tạo/ghi đè quy tắc tích điểm (append-only, có audit) — cần data_steward. */
  @Roles("data_steward", "loyalty_manager")
  @Post("earn-rules")
  async createEarnRule(@Body() body: unknown, @Req() req: Request) {
    const dto = validate(earnRuleSchema, body, "loyalty_earn_rule");
    const changedBy = (req as Request & { auth?: AuthContext }).auth?.principalId ?? "unknown";
    return { data: await setEarnRule(this.pool, dto, changedBy) };
  }

  /** Danh sách quy tắc đang hiệu lực. */
  @Get("earn-rules")
  async earnRules() {
    return { data: await listEarnRules(this.pool) };
  }

  /** Lịch sử audit của một ruleKey. */
  @Get("earn-rules/:ruleKey/audit")
  async earnRuleAudit(@Param("ruleKey") ruleKey: string) {
    return { data: await listEarnRuleAudit(this.pool, ruleKey) };
  }

  /** Kích hoạt thủ công lượt auto-earn (quét giao dịch chưa tích) — cần admin. */
  @Roles("admin", "loyalty_manager")
  @Post("earn-run")
  async earnRun() {
    return { data: await processUnearnedTransactions(this.pool) };
  }

  // ── L4: tier engine ──

  /** Danh sách nhóm hạng + các hạng của từng nhóm. */
  @Get("tier-groups")
  async tierGroups() {
    const groups = await listTierGroups(this.pool);
    const withTiers = await Promise.all(groups.map(async (g) => ({ ...g, tiers: await listTiers(this.pool, g.id) })));
    return { data: withTiers };
  }

  /** Hạng hiện tại của một khách (mọi nhóm). */
  @Get("tiers")
  async memberTiers(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_member_tiers");
    return { data: await getMemberTiers(this.pool, occId) };
  }

  /** Tính lại hạng cho 1 khách (mọi nhóm active) — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("tiers/recompute")
  async recomputeTier(@Body() body: unknown) {
    const { occId } = validate(loyaltyBalanceQuerySchema, body, "loyalty_recompute_tier");
    const groups = await listTierGroups(this.pool);
    for (const g of groups) await recomputeMemberTier(this.pool, occId, g.id);
    return { data: await getMemberTiers(this.pool, occId) };
  }

  /** Tính lại hạng toàn hệ (quét) — cần admin. */
  @Roles("admin", "loyalty_manager")
  @Post("tiers/recompute-all")
  async recomputeAllTiers() {
    return { data: await recomputeAllTiers(this.pool) };
  }

  // ── L5: reward catalog + redemption cross-brand ──

  /** Danh mục reward đang phát hành. */
  @Get("rewards")
  async rewards() {
    return { data: await listRewards(this.pool) };
  }

  /** Đổi điểm lấy reward (burn điểm + phát voucher) — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("rewards/redeem")
  async redeem(@Body() body: unknown) {
    const dto = validate(rewardRedeemSchema, body, "loyalty_reward_redeem");
    return { data: await redeemReward(this.pool, dto) };
  }

  /** Voucher của một khách. */
  @Get("vouchers")
  async vouchers(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_vouchers");
    return { data: await listMemberVouchers(this.pool, occId) };
  }

  /** Dùng voucher tại một brand (cross-brand; FIXED tiêu partial) — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("vouchers/use")
  async useVoucher(@Body() body: unknown) {
    const dto = validate(voucherUseSchema, body, "loyalty_voucher_use");
    return { data: await useVoucher(this.pool, dto) };
  }

  // ── L6: campaign + gamification ──

  /** Danh mục challenge đang chạy. */
  @Get("challenges")
  async challenges() {
    return { data: await listChallenges(this.pool) };
  }

  /** Tiến độ challenge của một khách. */
  @Get("challenges/progress")
  async challengeProgress(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_challenge_progress");
    return { data: await getMemberProgress(this.pool, occId) };
  }

  /** Tạo mã giới thiệu cho một khách — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("referral/create")
  async referralCreate(@Body() body: unknown) {
    const { occId } = validate(referralCreateSchema, body, "loyalty_referral_create");
    return { data: { code: await createReferralCode(this.pool, occId) } };
  }

  /** Referee dùng mã giới thiệu — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("referral/join")
  async referralJoin(@Body() body: unknown) {
    const dto = validate(referralJoinSchema, body, "loyalty_referral_join");
    await joinReferral(this.pool, dto.code, dto.refereeOccId);
    return { data: { ok: true } };
  }

  // ── L7: liability (IFRS15/ASC606) + inter-company settlement ──

  /** Nghĩa vụ điểm mới nhất theo pháp nhân/loại điểm. */
  @Roles("analyst", "loyalty_manager")
  @Get("liability")
  async liability() {
    return { data: await getLatestLiability(this.pool) };
  }

  /** Chốt snapshot nghĩa vụ điểm (tính lại + lưu) — cần admin. */
  @Roles("admin", "loyalty_manager")
  @Post("liability/snapshot")
  async liabilitySnapshot() {
    return { data: await computeLiabilitySnapshot(this.pool) };
  }

  /** Đặt đơn giá điểm + breakage (append-only) — cần admin. */
  @Roles("admin", "loyalty_manager")
  @Post("liability/point-price")
  async pointPrice(@Body() body: unknown) {
    const b = body as { currencyCode?: unknown; companyCode?: unknown; pricePerPoint?: unknown; breakageRate?: unknown };
    if (typeof b.currencyCode !== "string" || typeof b.pricePerPoint !== "number") {
      return { error: { code: "INVALID_AMOUNT", message: "currencyCode (string) + pricePerPoint (number) bắt buộc." } };
    }
    await setPointPrice(this.pool, {
      currencyCode: b.currencyCode, pricePerPoint: b.pricePerPoint,
      ...(typeof b.companyCode === "string" ? { companyCode: b.companyCode } : {}),
      ...(typeof b.breakageRate === "number" ? { breakageRate: b.breakageRate } : {}),
    });
    return { data: { ok: true } };
  }

  /** Báo cáo settlement inter-company theo kỳ (YYYY-MM) — cần analyst. */
  @Roles("analyst", "loyalty_manager")
  @Get("settlement")
  async settlement(@Query() query: Record<string, string>) {
    const period = query["period"] ?? new Date().toISOString().slice(0, 7);
    return { data: await getSettlementReport(this.pool, period) };
  }

  // ── L8: thẻ thành viên (card/QR) + stored-value wallet ──

  /** Phát thẻ cho khách — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("cards/issue")
  async issueCard(@Body() body: unknown) {
    const { occId } = validate(cardIssueSchema, body, "loyalty_card_issue");
    return { data: await issueCard(this.pool, occId) };
  }

  /** Resolve khách theo số thẻ / QR token (POS) — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Get("cards/resolve")
  async resolveCard(@Query() query: Record<string, string>) {
    const q = (query["q"] ?? "").trim();
    if (!q) return { error: { code: "INVALID_AMOUNT", message: "Thiếu tham số q (số thẻ / QR token)." } };
    return { data: await resolveByCard(this.pool, q) };
  }

  /** Khóa thẻ (mất/thu hồi) — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("cards/block")
  async blockCard(@Body() body: unknown) {
    const dto = validate(cardBlockSchema, body, "loyalty_card_block");
    await blockCard(this.pool, dto.cardNo, dto.status ?? "blocked");
    return { data: { ok: true } };
  }

  /** Nạp tiền ví stored-value — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("stored-value/topup")
  async svTopup(@Body() body: unknown) {
    const dto = validate(storedValueSchema, body, "loyalty_sv_topup");
    return { data: await topUp(this.pool, dto.occId, dto.amount, dto.idempotencyKey) };
  }

  /** Chi tiêu ví stored-value — cần csr. */
  @Roles("csr", "loyalty_ops")
  @Post("stored-value/pay")
  async svPay(@Body() body: unknown) {
    const dto = validate(storedValueSchema, body, "loyalty_sv_pay");
    return { data: await payWithStoredValue(this.pool, dto.occId, dto.amount, dto.idempotencyKey) };
  }

  /** Số dư ví stored-value. */
  @Get("stored-value/balance")
  async svBalance(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_sv_balance");
    return { data: { balance: await storedValueBalance(this.pool, occId) } };
  }
}
