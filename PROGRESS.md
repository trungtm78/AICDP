# PROGRESS — AICDP (admin-console UI)

> File duy trì ngữ cảnh qua các phiên. Đọc file này + spec gốc (`DESIGN.md`, `CLAUDE.md`, `Requirements/Notes.txt`) TRƯỚC khi làm gì sau `/clear`.

## Trạng thái tổng quan
- **Nhánh:** `feat/foundation-core` (chưa push).
- **App:** admin-console `http://localhost:8073` · core-api `:8071` · PG18 `AI_CDP_Pro` @5433.
- **Test/coverage:** admin-console **25/25 unit PASS** · `tsc` sạch · `vite build` OK. Patch (rebrand) là cosmetic (token/SVG/nhãn) — phủ bởi test render 4 màn + Login(Brand); coverage-v8 chưa cài (không cài thêm dep cho patch rename).

## Milestone đã xong
0. **Dark theme "Slate sâu" + toggle Light/Dark** (mặc định Dark — chất kỹ thuật). MỚI NHẤT:
   - `src/ui/ThemeProvider.tsx` (context + localStorage `aicdp-theme` + set `data-theme`, mặc định dark) + test 3 case.
   - Init script chống flash trong `index.html`; bọc `ThemeProvider` ở `main.tsx`; toggle Sun/Moon ở Topbar (`App.tsx`).
   - Token dark override tại `:root[data-theme="dark"]` trong `src/index.css` (bg #0B0F1A, accent #818CF8, accent-fg tối) + token `--color-scrim`.
   - Sửa hardcode: overlay Modal/Drawer/CommandPalette → `bg-scrim`; Tooltip → surface-alt.
   - ECharts đổi theme runtime: `charts/theme.ts` đọc CSS var (`chartTokens/tooltip/vizPalette/axisStyle/areaColor/heatmapRange`); `EChart` remount theo `useTheme`; wrappers subscribe theme.
   - Verify: tsc sạch · build OK · **28/28 test** (25 + 3 ThemeProvider) · screenshot Dark (mặc định) + Light (`*-light.png`).

1. **AI Phase A** (backend + frontend) — scoring/feature/reco v2/forecast/decisioning/LLM gateway/generative + AI governance. core-api 240 test.
2. **Redesign UI/UX CDP-grade** (custom primitives `src/ui/*` + ECharts + Geist + lucide + app shell + 11 workspace). Commit trước đó.
3. **Rebrand AICDP + Indigo AI + logo Channel Hub** (task hiện tại — XONG):
   - Màu: accent Indigo `#4F46E5`, gradient indigo→violet `#4F46E5→#7C3AED→#A855F7`, nền mát `#F6F7FB` (`src/index.css`, `src/ui/charts/theme.ts`, `charts/index.tsx`).
   - Logo: **Channel Hub** (lõi AI/CDP + 6 kênh) + wordmark **AICDP** (`src/ui/Brand.tsx`, `public/logo*.svg`, `index.html`).
   - Rename hiển thị OCC→AICDP: brand + nhãn **"OCC ID"→"AICDP ID"** (Audiences/Loyalty/Governance/Customers); `occId`/API/DB GIỮ NGUYÊN.
   - Test cập nhật theo nhãn: `AudiencesScreen.test`, `LoyaltyScreen.test`, `GovernanceScreen.test`, `e2e/admin-console.e2e`, `e2e/system-dataflow.e2e`.
   - DESIGN.md: Color Indigo + Logo Channel Hub + Product name AICDP + Decisions Log.
   - Verify trực quan: Playwright `e2e/screens.shot.spec.ts` → `docs/assets/screens/*.png` (Indigo + AICDP + Channel Hub + nhãn AICDP ID xác nhận).

## Quyết định kiến trúc/thiết kế quan trọng
- `occId` là hợp đồng backend/DB — CHỈ đổi chuỗi hiển thị, không đổi biến/API.
- 1 accent UI = Indigo; gradient indigo→violet chỉ ở điểm nhấn (logo/hero/nút primary/active nav).
- Custom primitives (không shadcn/Radix) + ECharts (không Recharts).

## Task đang làm dở
- (không) — Dark theme HOÀN TẤT & commit. **Trụ mới đã CHỐT plan (ENG CLEARED): Journey Builder.**

## ✅ M1 (Journey engine backend) — XONG (commit)
- migration `db/migrations/013_journey_engine.sql` (journey mở rộng + journey_version + journey_participant + journey_step_run + activation idempotency_key).
- `services/core-api/src/journey/journey.types.ts` · `journey-engine.service.ts` (enroll/enrollSegment/tick/advance/validate/retry) · `journey-admin.service.ts` (draft/publish/activate/pause/participants/retry/force-exit) · `journey-engine.spec.ts`.
- `http/journey.controller.ts` đủ endpoint + `POST /v1/journeys/tick` (dev) · `http/schemas.ts` (+journey schemas) · `http/errors.ts` (+JOURNEY_* codes) · `http/journey.e2e.spec.ts` (viết lại theo engine) · `activation.service.ts` (+idempotencyKey) · `test-helpers/db.ts` (+truncate bảng mới).
- Codex-hardened (4 fix): tick dùng client cho READ (tránh deadlock), validate predicate + node try/catch, cardinality cạnh, publish re-read trong lock.
- Verify: tsc sạch · **257 test pass** (16 engine + 3 e2e). Effectively-once: step_run UNIQUE(participant,node) + action idempotencyKey.

## ✅ M2 (report) + M3 (trigger/scheduler) — XONG (commit)
- **M2**: `journey-report.service.ts` + `GET /v1/journeys/:id/report` (funnel/counts/attribution windowDays/enrollmentByDay). Engine ghi step_run exit (funnel per-exit). Codex-hardened (funnel version-agnostic, bỏ double-count).
- **M3**: `journey-scheduler.ts` (interval single-flight, lifecycle, await shutdown) + `journey-triggers.service.ts` (enrollEventJourneys derive eventName từ definition, runSegmentEntry) + ingest hook fire-and-forget + app.module đăng ký + vitest tắt scheduler. Codex-hardened (3 fix).
- **Backend Journey (M1–M3) XONG: 267 test pass, tsc sạch.** API contract sẵn cho UI (bên dưới).

## ▶ NEXT sau /clear: Journey Builder — M4+M5 (Frontend, canvas react-flow)
> Đọc plan file + `services/core-api/src/http/journey.controller.ts` (contract) + `apps/admin-console/src/screens/JourneysScreen.tsx` (rewrite) + hệ primitives `src/ui/*` (đã có Panel/Table/Drawer/Button/Badge/StatTile + ECharts Funnel/ForecastLine).

**Dep mới:** `@xyflow/react` (react-flow v12) trong admin-console (`pnpm --dir apps/admin-console add @xyflow/react`). Nhớ import CSS `@xyflow/react/dist/style.css`.

**API contract (M1–M3, prefix /v1/journeys):**
- `GET /` → list + {participants, completed}. `POST /` {name,triggerType,triggerConfig,definition} → draft. `GET /:id`. `PUT /:id` (save draft/paused).
- `POST /:id/publish` (400 JOURNEY_INVALID) · `/:id/activate` (409 nếu chưa publish) · `/:id/pause` · `/:id/archive`.
- `POST /:id/enroll` {occIds?|useSegment:true} → {enrolled}. `GET /:id/participants?status=&limit=&offset=` → {data, meta:{total}}. `POST /:id/participants/:pid/retry` · `/force-exit`.
- `GET /:id/report?windowDays=` → {entered,active,completed,exited,failed,exitReasons[],funnel[{nodeId,nodeType,reached}],attribution{windowDays,orders,revenue,convertedCustomers,loyaltyPointsIssued,activationsAllowed,activationsSuppressed},enrollmentByDay[{day,count}]}.
- `POST /tick` {limit} (dev, admin/marketer — gọi để chạy engine trong demo/E2E).
- **Definition shape**: `{nodes:[{id,type,config,pos?}],edges:[{from,to,branch?}]}`. type: entry(config{trigger:'event'|'segment'|'manual',eventName?,segment?}) · wait(config{delayMinutes}) · condition(config{predicate:{kind:'lifecycle'|'churnRiskGte'|'propensityGte'|'loyaltyMinGte'|'favoriteCategory'|'consentGranted', equals?|value?|purpose?}}) · action(config{kind:'activation'{purpose,channel,destination}|'loyalty_bonus'{points}}) · exit. condition có 2 cạnh branch yes/no; node khác 1 cạnh.

**M4 (canvas builder):** rewrite `JourneysScreen.tsx` → List (bảng journey + status + entered/completed + nút Report/Sửa/Tạo). Detail route `/journeys/:id` (thêm ở App.tsx) tabs **Build/Participants/Report**. Build = react-flow canvas: palette 5 node, kéo-thả, nối cạnh, click node → Drawer cấu hình (đã có `Drawer` trong ui); nút Lưu(PUT)/Publish/Activate/Pause. Custom node theo token (auto dark/light). `api.ts`+`types.ts` thêm journey client/types.
**M5 (participants + report UI):** Participants = Table (lọc status, retry/force-exit). Report = ECharts **Funnel** (dùng component có sẵn) + StatTiles (entered/completed/converted/revenue) + Table conversion từng node + line enrollment/day.
**Checkpoint mỗi milestone:** tsc + vite build + component test + /review→/codex + commit. Cuối: E2E Playwright dựng journey qua canvas → publish → activate → enroll → tick → Report (chụp Dark+Light). Servers: core-api :8071 + admin-console :8073 (bind localhost) + seed-demo.

## (cũ, tham chiếu) M1 chi tiết ban đầu:
> Plan đầy đủ đã duyệt (qua /plan-eng-review + codex, 0 unresolved): `~/.claude/plans/h-y-ph-n-t-ch-research-delightful-spindle.md`. ĐỌC PLAN ĐÓ TRƯỚC.
> Nghiệp vụ backend hiện có (bản kiểm kê): identity atomic · loyalty double-entry · consent append-only · segment.previewSegment · activation (consent gate) · analytics/AI Phase A. Journey hiện chỉ 1-step (migration 007).

**Kiến trúc đã chốt:** engine = máy trạng thái BỀN VỮNG trong Postgres + tick worker (`@nestjs/schedule @Interval`, single-flight `pg_try_advisory_lock`, `FOR UPDATE SKIP LOCKED`). KHÔNG thêm Redis/queue. Effectively-once = `journey_step_run UNIQUE(participant_id,node_id)` ghi CÙNG transaction advance + action idempotency key `journey:{pid}:{nodeId}`. Trigger Event+Segment+Manual. Re-enrollment = once-ever (`UNIQUE(journey_id,occ_id)`, cột `allow_re_enroll` default false). Versioning qua `journey_version` snapshot. Publish↔activate TÁCH. Retry transient (attempts≤3 backoff) vs permanent. Canvas react-flow (`@xyflow/react`) ở M4.

**M1 việc cụ thể (TDD RED→GREEN, PG18 @5433 thật):**
1. `db/migrations/013_journey_engine.sql`: mở rộng `cdp.journey` (definition jsonb, trigger_type, trigger_config, status, published_version, allow_re_enroll, updated_at, published_at); `journey_version`; `journey_participant` (+attempts, next_run_at, UNIQUE(journey_id,occ_id), partial index `(next_run_at) WHERE status='active'`); `journey_step_run` (UNIQUE(participant_id,node_id)). Backward-compat: journey 007 cũ → status='draft', definition=null.
2. `services/core-api/src/journey/journey.types.ts` (node/edge/definition/predicate types) + `journey-engine.service.ts` (enroll, tick, advance, validatePublish). Tái sử dụng segment/activation(consent gate)/loyalty.earn/consent.isAllowed/feature.
3. `http/journey.controller.ts`: thêm GET/POST/PUT + publish/activate/pause/archive/enroll/participants(+pagination)/retry/force-exit. Giữ legacy `run()` chỉ cho journey definition=null.
4. Tests `journey-engine.spec.ts`: mọi nhánh advance (wait/condition yes-no/action activation+consent suppress/loyalty/exit/failed), enroll once-ever idempotent, tick SKIP LOCKED, restart-safe, action-replay không gửi trùng, validate reject graph xấu.
5. Checkpoint M1: verification (pnpm test + tsc) → /review → /codex → commit → cập nhật PROGRESS.md → sang M2 (report).

**Dep cần thêm:** `@nestjs/schedule` (core-api), `@xyflow/react` (admin-console, cho M4).
**Lưu ý môi trường:** seed-demo lại sau khi test truncate DB; core-api tsx KHÔNG emit decorator metadata → DI phải @Inject tường minh (verify boot thật).

## Task kế tiếp (đề xuất, đợt sau)
- Tree-shake ECharts giảm bundle (hiện ~482KB gzip).
- Dark "war-room" theme (token đã scaffold).
- Cập nhật deck PPTX `docs/*.pptx` sang thương hiệu AICDP + screenshot mới.

## File liên quan chính
- `apps/admin-console/src/index.css`, `src/ui/charts/theme.ts`, `src/ui/Brand.tsx`, `public/logo*.svg`, `index.html`
- `src/screens/{Audiences,Loyalty,Governance,Customers,Login}Screen.tsx` + `*.test.tsx`
- `e2e/{admin-console,system-dataflow,screens.shot}.e2e.spec.ts`
- `DESIGN.md`
