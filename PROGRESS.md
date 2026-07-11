# PROGRESS — Tính năng "Kết nối" chạy THẬT (connector framework)

> File duy trì ngữ cảnh qua phiên. Sau `/clear`: đọc file này + plan gốc + `CLAUDE.md` TRƯỚC.
> Plan gốc: `~/.claude/plans/h-y-ph-n-t-ch-research-delightful-spindle.md` (đã research + threat-model đầy đủ).
> Lịch sử trước (Journey Builder, AI Phase A, rebrand, R0-R3d…) đã hoàn tất — xem git log + memory `MEMORY.md`.
> Branch `feat/foundation-core` · DB `AI_CDP_Pro` PG18 @5433 · demo live 192.168.1.93:8070 (admin/Och@2026).

## Quyết định kiến trúc (chốt)
- 1 engine adapter + auth-strategy registry + preset per-connector (phủ REST/OData/OAuth2); transport riêng RPC(Odoo)/SOAP/IPN(payment)/provider(GA4,Zalo…).
- ~40+ connector "Đã setup" (Group 1) / ~14 "Chưa setup" (Group 2, stub honest, không giả success).
- RudderStack: KHÔNG dùng rudder-server (ELv2 + phụ thuộc control-plane-cloud); TUỲ CHỌN nhúng rudder-transformer (MIT) cho 200+ destination.
- Bảo mật P0 (chặn go-live): SSRF guard · secret AES-256-GCM at-rest · webhook token constant-time · IPN checksum · consent gate egress · reverse-ETL chỉ-SELECT.
- **Checkpoint /review+/codex ở ranh giới PHASE** (framework là 1 khối cohesive; không mỗi micro-task). Commit + coverage mỗi task.
- Coverage: đã cài `@vitest/coverage-v8@3.2.6` (devDep). Đo: `pnpm exec vitest run <files> --coverage --coverage.provider=v8 --coverage.include='...' --coverage.reporter=json-summary --coverage.reportsDirectory=./cov-tmp` rồi đọc `cov-tmp/coverage-summary.json`.

## Phase (milestone)
- [~] **Phase 1 — Framework + nền bảo mật P0** (ĐANG LÀM: Task 3/5)
- [ ] Phase 2 — INBOUND thật (webhook token + write-key + reverse-ETL)
- [ ] Phase 3 — Cổng thanh toán IPN (VNPay/MoMo/ZaloPay)
- [ ] Phase 4 — OUTBOUND 1A (analytics+messaging verify-free) + wiring activation
- [ ] Phase 5 — VN 1B (KiotViet/GHN/MISA…) + messaging 1B (Zalo ZNS/VietGuys/eSMS…)
- [ ] Phase 6 — ERP (generic REST/OData + preset) + warehouse
- [ ] Phase 7 — Group 2 stub + Frontend 2-group + deploy

## Phase 1 — task
- [x] **Task 1 — SSRF guard** `src/connector/ssrf-guard.ts`(+spec): `assertSafeUrl` (https-only, chặn IP nội bộ/metadata/CGNAT, resolve-then-pin chống DNS-rebinding, no userinfo) + `isPrivateIp` (v4/v6/mapped). 15 test PASS, line **92.23%**.
- [x] **Task 2 — Secret encryption** `src/connector/secrets.ts`(+spec): AES-256-GCM encrypt/decrypt/mask + encrypt/decrypt/maskConfig + `getConnectorSecretKey` (fail-fast prod). 14 test PASS, line **97.5%**. ErrorCode connector thêm ở `src/http/errors.ts`.
- [ ] **Task 3 — Migration 024** `db/migrations/024_connector_live.sql` (ĐANG TỚI): connection cols (inbound_token_hash, oauth_state, last_checked_at, last_error, pull_cursor) + `connector_event` (inbound log) + `connector_delivery` (outbound log). Nhớ thêm vào `test-helpers/db.ts` truncateAll.
- [ ] Task 4 — adapter types + transport/auth registry + `http-client.ts` (fetch pin IP từ assertSafeUrl).
- [ ] Task 5 — health/delivery/data-summary service + endpoint chung.
- [ ] Checkpoint Phase 1: verification → /review → /codex.

## Test/coverage
- Full BE suite: **368 PASS / 0 FAIL** · tsc BE sạch.

## Nợ/lưu ý
- Lỗ hổng hiện trạng: `cdp.connection.config` lưu plaintext + trả nguyên qua `GET /connections` (`connector.service.ts:100`, `connector.controller.ts:66`) → Task 5/FE vá bằng encryptConfig lúc tạo + maskConfig lúc đọc.
- Môi trường: core-api tsx KHÔNG emit decorator metadata → DI @Inject tường minh (verify boot thật); seed lại sau khi test truncate DB.
