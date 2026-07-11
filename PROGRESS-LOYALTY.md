# PROGRESS — Loyalty Engine hợp nhất "quản trị sâu" (coalition, đa công ty)

> Duy trì ngữ cảnh qua phiên. Sau `/clear`: đọc file này + plan `~/.claude/plans/hi-n-ph-n-qu-n-l-logical-raven.md` + research `…-agent-aa2a7d6842910ff9f.md` + `CLAUDE.md` TRƯỚC.
> Branch `feat/foundation-core` · DB `AI_CDP_Pro` PG18 @5433 · demo 192.168.1.93:8070 (admin/Och@2026).

## Quyết định chốt
- Đa công ty, hạch toán riêng + **cơ chế chuyển đổi điểm** (brand → điểm CHUNG tập đoàn coalition).
- **Nhiều loại điểm/ví theo brand** + điểm nhóm + tỷ giá quy đổi.
- Làm **TRỌN #10** (ledger đa-currency, tier, expiry/breakage, reward/voucher, redemption cross-brand,
  campaign+gamification, inter-company settlement + liability IFRS15/ASC606, POS realtime, thẻ/QR, stored-value, admin FE, RBAC).
- Tính **quản trị + mở rộng 10/10** (config append-only + audit, rule engine, data-driven, RBAC theo pháp nhân).

## Nguyên tắc GIỮ NGUYÊN (không phá)
Double-entry + balance=projection (cấm âm) nay **per (txn,currency)**; idempotency+fingerprint; advisory-lock per occ;
reservation state machine; ledger append-only + audit; earn KHÔNG ở ingest (qua rule/journey); consent chỉ gate ở activation;
tương thích ngược chữ ký `earn/reserve/capture/release/getBalance` (mặc định = GROUP currency).

## Lộ trình (L0→L9) — mỗi phase: TDD → verify → /review → /codex → commit
- [x] **L0 — Nền đa-scope HOÀN TẤT** (migration `025_loyalty_company_currency.sql` + kernel currency-aware + fix merge đa-ví). **592 test PASS**, tsc sạch, zero regression.
  - `cdp.company` (occ_fnb, occ_hotel) + `cdp.brand.company_id` (map F&B vs hotel).
  - `cdp.point_currency` (GROUP 'OCC_POINT' + mỗi brand 1 BRAND currency `<BRAND>_PT`) + `cdp.point_conversion` (brand→group 1:1 seed).
  - `loyalty_entry.currency_id` (+ backfill entry cũ về group) + `loyalty_txn` thêm brand_id/store_id/source/ref_message_id/correlation_id.
  - Trigger `assert_loyalty_balanced` → cân **per (txn, currency_id)**.
  - `loyalty.service.ts`: postEntries/accountBalanceTx/balanceTx currency-aware; earn/reserve/settle/getBalance/listLedger/listMembers dùng GROUP mặc định; `getGroupCurrencyId` cache + `_resetLoyaltyCurrencyCache`.
  - `identity.repo transferLoyalty`: merge chuyển điểm **theo từng currency** (đa ví). Test `loyalty-coalition.spec.ts` (schema+seed+regression+trigger per-currency).
- [x] **L1 — Kernel đa-currency public HOÀN TẤT** (commit `c4e0459`, **604 test**): `convert` (đổi điểm brand→group/giữa currency qua point_conversion; burn from + mint floor(points*rate) to; cân per-currency; CURRENCY/CONVERSION_NOT_FOUND), `adjust` (± lý do bắt buộc + audit, RBAC data_steward, cấm âm), `transfer` (khách→khách, lock 2 occ, idempotent), `listWallets` (đa ví). API `v1/loyalty/{convert,adjust,transfer,wallets}` + schemas + LoyaltyError codes mới. Coverage loyalty.service ≥93%. FE rich để ở L9 (member-360). **⏳ Checkpoint /review+/codex tài chính (L0+L1 ledger) NÊN chạy trước khi xây tiếp — ledger là nền mọi phase.**
- [ ] **L2 — Point lots + expiry/breakage (RESUME TỪ ĐÂY)**: `cdp.loyalty_lot` (occ, currency, points_remaining, expire_at, issuing_company); earn tạo lô có hạn theo `cdp.expiration_policy` (ROLLING/FIXED/ACTIVITY); burn/convert/reserve consume **FIFO** theo lô; scheduler đáo hạn (lô hết hạn → giảm available + hạch toán **breakage** account `system:breakage`); giảm liability. TDD (FIFO, expiry job, breakage cân bằng). LƯU Ý: earn hiện chỉ ghi entry — cần gắn lô; đảm bảo available = Σ lô còn hạn.
- [ ] L2 — Point lots + expiry/breakage (loyalty_lot, expiration_policy, FIFO burn, scheduler đáo hạn, breakage).
- [ ] L3 — Earn rule engine (append-only) + auto-earn từ canonical_transaction (qua rule/journey) + qualifying vs non-qualifying.
- [ ] L4 — Tier engine (tier_group/tier/member_tier, qualify points/spend/visits/nights, review rolling/calendar, lên-xuống hạng + soft-landing, benefits) + scheduler + FE.
- [ ] L5 — Reward catalog + redemption cross-brand (reward_catalog_item + voucher, reserve→capture, đổi điểm chung tiêu brand bất kỳ) + FE.
- [ ] L6 — Campaign + gamification (promotion, referral, birthday, challenge/streak/lì xì) + FE.
- [ ] L7 — Liability + inter-company settlement (point_price, settlement_txn credit-in-arrears, liability_snapshot IFRS15/ASC606 theo pháp nhân, netting) + FE dashboard.
- [ ] L8 — POS/PMS realtime authorization (reserve→capture đồng bộ qua connector) + member_card (thẻ/QR) + stored-value wallet (nạp tiền/pay-with-points).
- [ ] L9 — Admin FE hoàn chỉnh workspace Loyalty (Programs/Currency/Rules/Tiers/Rewards/Campaigns/Member-360/Liability) + RBAC role loyalty_manager/loyalty_ops theo company/brand + báo cáo.

## Lưu ý kỹ thuật
- Migration ở **repo-root `db/migrations/`** (không phải services/core-api/db). Chạy tự động theo tên (migrate.ts), idempotent (IF NOT EXISTS/ON CONFLICT).
- truncateAll GIỮ company/point_currency/point_conversion (reference seed) — không truncate. Cache group currency id ổn định.
- Deploy: cần env `CONNECTOR_SECRET_KEY` (đã set). Migration 025 tự chạy lúc core-api start. Deploy mốc sau L2, L5, L9.
- Test: `pnpm exec vitest run` (592). Coverage patch ≥90% mỗi phase. Checkpoint /review→/codex ranh giới phase.
