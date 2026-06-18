# CLAUDE.md — OCC-CDP

Hướng dẫn dự án cho Claude Code. (Quy ước toàn cục ở `~/.claude/CLAUDE.md` vẫn áp dụng: tiếng Việt, PostgreSQL 18 @5433, autonomous continuation.)

## Sản phẩm
OCC-CDP — Customer Data Platform enterprise self-host cho tập đoàn F&B đa thương hiệu OCC. Hợp nhất OCC ID xuyên thương hiệu, loyalty hợp nhất, dashboard realtime, AI cross-selling. Yêu cầu gốc: `Requirements/Notes.txt`. Plan đầy đủ: `~/.claude/plans/h-y-research-v-ch-n-vivid-lynx.md`.

## Môi trường
- **Database:** `AI_CDP_Pro` trên PostgreSQL 18 @ `127.0.0.1:5433`, role app `occ_cdp` (KHÔNG dùng `postgres` làm db_user). DATABASE_URL trong `.env`.
- **App:** admin-console tại `http://localhost:8073/`; core-api tại `:8071`.
- **Hạ tầng:** ClickHouse `:8123`, Redis `:6379`, MinIO `:9000` (docker-compose.dev.yml). RudderStack self-host (GĐ sau).
- Repo: github.com/trungtm78/AICDP.

## Kiến trúc
- Nền tảng: RudderStack OSS (ingestion/routing/reverse-ETL) + domain logic tự build.
- **`core-api` (NestJS) gom identity + loyalty + consent + ingestion trong MỘT transaction boundary ACID** (bắt buộc đúng tiền/đúng danh tính tại POS). Các service khác (analytics-api, ai-service, activation, ...) tách riêng.
- Postgres 18 = system of record; ClickHouse = OLAP; Redis = cache (Profile API); MinIO = object storage.

## Quy tắc kỹ thuật bắt buộc (từ review — để đạt 10/10)
- **Identity (OCC ID):** `UNIQUE(identifier_type, value_normalized)` + `ON CONFLICT` + `pg_advisory_xact_lock`; một hàm `resolve_occ_id` atomic; merge qua mapping/version table (không destructive); materialized `resolved_identifier→occ_id` (không traverse graph runtime).
- **Loyalty:** double-entry, `idempotency_key` unique, reserve→capture→release, balance = projection (không cột mutable), cấm balance âm.
- **Consent:** deny-by-default chokepoint; ingestion + loyalty LUÔN nhận giao dịch, chỉ **activation** mới gate consent.
- **Ingestion idempotency:** key = `{brand}:{store}:{pos_transaction_id}` (unique).
- **Error envelope:** `{code,message,why,fix,field_path,schema_version,docs_url,correlation_id,retryable,quarantine_id}` — không nuốt data im lặng.
- **Tracking plan as source-of-truth:** `docs/architecture/tracking-plan-spec.md` sinh schema registry + SDK types.

## Hệ thiết kế
Luôn đọc `DESIGN.md` trước mọi quyết định UI. Industrial-Minimal "control tower", Geist + Geist Mono, accent Signal Teal `#0EA5A4`, density theo persona, dark-first war-room, UX State Contract, i18n VN + WCAG AA. QA flag code lệch DESIGN.md.

## Quy trình bắt buộc MỖI TASK
1. **/write-plan → /execute-plan → TDD** (RED → GREEN → REFACTOR).
2. Lỗi: **systematic-debugging + /investigate**, fix tận gốc — CẤM vá tạm.
3. **Checkpoint mỗi task:** verification-before-completion → **/review → /codex** (codex SAU review để có cross-model) → **/qa** (E2E thật bằng Playwright/Chromium click qua UI; CẤM seed/đăng ký data qua API/function).
4. **Checkpoint mỗi milestone:** **/plan-eng-review** đối chiếu code với spec gốc; lệch → quay lại giai đoạn thiết kế, không improvise.
5. Cổng 2: không đóng/merge khi code đã trôi khỏi kế hoạch.
6. **Nhóm chức năng xong:** /uat-test-writer-web → /uat-test-runner-web.
7. **Toàn hệ thống xong:** /expert-test-writer → /expert-test-runner.

## Quy ước code
- TypeScript strict; comment/mô tả tiếng Việt, identifier/keyword tiếng Anh.
- Conventional Commits; commit mỗi task; KHÔNG push trừ khi được yêu cầu.
