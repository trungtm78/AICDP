# PROGRESS — AICDP (admin-console UI)

> File duy trì ngữ cảnh qua các phiên. Đọc file này + spec gốc (`DESIGN.md`, `CLAUDE.md`, `Requirements/Notes.txt`) TRƯỚC khi làm gì sau `/clear`.

## Trạng thái tổng quan
- **Nhánh:** `feat/foundation-core` (chưa push).
- **App:** admin-console `http://localhost:8073` · core-api `:8071` · PG18 `AI_CDP_Pro` @5433.
- **Test/coverage:** admin-console **25/25 unit PASS** · `tsc` sạch · `vite build` OK. Patch (rebrand) là cosmetic (token/SVG/nhãn) — phủ bởi test render 4 màn + Login(Brand); coverage-v8 chưa cài (không cài thêm dep cho patch rename).

## Milestone đã xong
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
- (không) — task rebrand đã hoàn tất, đang ở bước checkpoint (`/review` → `/codex`) + commit.

## Task kế tiếp (đề xuất, đợt sau)
- Tree-shake ECharts giảm bundle (hiện ~482KB gzip).
- Dark "war-room" theme (token đã scaffold).
- Cập nhật deck PPTX `docs/*.pptx` sang thương hiệu AICDP + screenshot mới.

## File liên quan chính
- `apps/admin-console/src/index.css`, `src/ui/charts/theme.ts`, `src/ui/Brand.tsx`, `public/logo*.svg`, `index.html`
- `src/screens/{Audiences,Loyalty,Governance,Customers,Login}Screen.tsx` + `*.test.tsx`
- `e2e/{admin-console,system-dataflow,screens.shot}.e2e.spec.ts`
- `DESIGN.md`
