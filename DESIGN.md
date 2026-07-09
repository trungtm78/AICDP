# Design System — AICDP

## Product Context
- **What this is:** Admin console enterprise + exec war-room cho **AICDP** — AI Customer Data Platform (CDP đa thương hiệu F&B self-host). (Tên cũ "OCC-CDP" đã đổi thành AICDP, 2026-07-09.)
- **Who it's for:** Data steward, marketer, CSKH, analyst, compliance/DPO, executive (Ban điều hành). Người vận hành 8h/ngày.
- **Space/industry:** Customer Data Platform / MarTech (peers: Segment, Tealium, Hightouch, Amplitude). Tham chiếu UX: Linear, Vercel.
- **Project type:** Data-dense admin web app + realtime executive dashboard.
- **Memorable thing:** "Kiểm soát toàn cục, tức thì" — control tower: mọi số liệu 5 brand realtime, đáng tin, tra cứu 1 khách trong 2 giây.

## Aesthetic Direction
> **Cập nhật triển khai (2026-07-09, rev.2 — rebrand AICDP + Indigo AI):** hướng thực thi = **"Airy modern SaaS + bảng màu Indigo AI"** (kiểu Segment/Hightouch/Linear) — nhiều khoảng thở, card bo góc + shadow nhẹ, nền sáng mát; vẫn giữ độ chính xác (số căn phải `tabular-nums`, bảng hairline gọn) ở khu dữ liệu. Accent = **Indigo `#4F46E5`**; gradient **indigo→violet** (`#4F46E5→#7C3AED→#A855F7`) chỉ ở **điểm nhấn** (logo, hero KPI, nút primary, header, active nav). Component = **custom primitives (Tailwind thuần)**; chart = **ECharts**; icon = **lucide**. Xem "Color", "Stack", "Logo" bên dưới.

- **Direction:** Industrial/Utilitarian × Minimal (instrument-panel precision).
- **Decoration level:** minimal — typography + token + hairline borders; KHÔNG bubble/gradient/blob.
- **Mood:** Bình tĩnh, dày đặc, chính xác. Như bảng điều khiển khí cụ: cấu trúc rõ, số thẳng hàng, accent chỉ hút mắt vào thứ quan trọng.
- **Reference sites:** linear.app, vercel.com (density + tokens); hightouch.com (marketer self-service patterns).

## Typography
- **Display/Hero / war-room numbers:** Geist (700/800, tracking chặt) — precision, hỗ trợ đầy đủ dấu tiếng Việt.
- **Body/UI:** Geist (400/500).
- **Data/Tables:** Geist với `font-variant-numeric: tabular-nums` (số thẳng cột); Geist Mono cho ID/mã giao dịch/khóa idempotency.
- **Code:** Geist Mono.
- **Loading:** self-host (woff2) — không phụ thuộc CDN (self-host 100%, residency VN); preload weight 400/500/700.
- **Scale (rem, base 16px):** display-xl 2.25 / display 1.75 / h1 1.5 / h2 1.25 / h3 1.125 / body 0.875 (14px, density) / caption 0.75 / micro 0.6875. Line-height 1.35 body, 1.1 numbers.
- **Lý do single-family:** coherence khí cụ + đảm bảo diacritics tiếng Việt + perf; rủi ro đã chấp nhận.

## Color
> **Cập nhật 2026-07-09 (rev.2):** accent hệ thống = **Indigo `#4F46E5`** (indigo-600; hover `#4338CA`, subtle `#EEF2FF`). Nền sáng mát `#F6F7FB`, surface-alt `#F2F4F9`, border `#E6E8F0`. Gradient **indigo→violet** `#4F46E5→#7C3AED→#A855F7` (`.brand-gradient`/`.brand-text`) chỉ ở điểm nhấn. Hue biểu đồ (data-viz) CVD-safe: indigo `#4F46E5` · aqua `#1baf7a` · amber `#eda100` · green `#008300` · violet `#7c3aed`. Token thực tế xem `apps/admin-console/src/index.css`. (Lịch sử: Signal Teal → AIPOWER blue → Indigo.)

- **Approach:** restrained — neutral foundation + 1 accent + semantic; gradient chỉ cho brand/điểm nhấn.
- **Primary (accent):** `#4F46E5` (Indigo AI) — action chính, focus, selection, link.
- **Secondary:** neutral đậm `#334155` cho action phụ; KHÔNG thêm accent thứ 2 (giữ "tín hiệu" hiếm & có nghĩa).
- **Neutrals (cool slate):** bg `#FBFBFC` · surface `#FFFFFF` · surface-alt `#F4F5F7` · border `#E7E9EE` · border-strong `#CBD2DC` · text `#0B0E14` · text-muted `#5B6573` · text-subtle `#8A93A2`.
- **Semantic:** success `#16A34A` · warning `#D97706` · error `#DC2626` · info `#2563EB`.
- **Dark mode (mặc định, "Slate sâu" Linear/Vercel — chất kỹ thuật):** bg `#0B0F1A` · surface `#141A28` · surface-alt `#1B2333` · border `#232C40` · text `#E6E9F0` · text-muted `#98A2B8` · accent `#818CF8` (indigo-400) · accent-fg `#0B0F1A` (nút indigo sáng, chữ tối). Data-viz palette sáng hơn cho dark. **Toggle Light/Dark** (Sun/Moon ở topbar), lưu `localStorage["aicdp-theme"]` (mặc định dark), set `:root[data-theme]`; token override tại `:root[data-theme="dark"]` (index.css) → component tự đổi. Overlay dùng token `--color-scrim` (tối cả 2 theme). ECharts đọc CSS var lúc render → tự đổi theme.
- **Brand-kit:** 5 thương hiệu map vào `--brand-accent` token; brand context badge dùng màu này, KHÔNG ghi đè Signal Teal của hệ thống.
- **Tokens:** semantic (`--color-text-primary`, `--color-surface`, `--color-accent`...), OKLCH-based (Tailwind v4), không hardcode hex trong component.

## Spacing
- **Base unit:** 4px.
- **Density:** compact mặc định; modes **Compact / Comfortable / Audit-Dense** (default theo persona — marketer/CSKH = Comfortable).
- **Scale:** 2xs(2) xs(4) sm(8) md(12) base(16) lg(24) xl(32) 2xl(48) 3xl(64).
- **Table row:** 32px (Compact) / 36px / 40px (Comfortable).

## Layout
- **Approach:** grid-disciplined (admin) + hybrid (exec war-room).
- **Grid:** 12-col, gutter 16px; content tối đa 1440px; sidebar 8 workspace (Control Tower · Customers · Audiences · Journeys · Loyalty · Data Ops · Governance · Platform); command palette (Cmd/Ctrl+K) hạng nhất; sticky brand-context badge.
- **Target:** admin desktop ≥1280px (graceful → tablet cho view tra cứu); exec war-room màn lớn/TV; mobile chỉ read/approve.
- **Border radius:** sm 4 / md 6 / lg 8 / pill 9999 (chỉ status badge). Tight = precision, anti-bubble.
- **Elevation:** flat + hairline border; shadow chỉ cho overlay/popover/modal.

## UX State Contract (bắt buộc mọi data view — component dùng chung)
`loading(initial) · loading(more/streaming) · empty(no-data) · empty(filtered) · partial · stale(+timestamp) · error(full) · error(degraded/per-column) · success`. Realtime tile thêm: `live · reconnecting · disconnected-stale`. Builder thêm: `draft/autosave · invalid-node · publish-blocked(+reason) · simulation`.

## Motion
- **Approach:** minimal-functional.
- **Easing:** enter ease-out · exit ease-in · move ease-in-out.
- **Duration:** micro 80ms · short 160ms · medium 240ms · long 360ms. Realtime update: fade/pulse ≤120ms, không bounce/scale.
- **Reduced-motion:** tôn trọng `prefers-reduced-motion` (tắt pulse).

## i18n & Accessibility
- **i18n:** tiếng Việt mặc định; UTF-8; collation tiếng Việt (sort có/không dấu); format VND, ngày, timezone Asia/Ho_Chi_Minh; export CSV/XLSX UTF-8 BOM; truncation + tooltip cho cell hẹp (chuỗi VN dài hơn EN ~30%).
- **A11y:** WCAG AA — contrast ≥4.5:1 mọi text (kể cả muted), focus ring rõ trên mọi cell tương tác, keyboard-nav đầy đủ cho data grid (mũi tên di chuyển cell), screen-reader header association + announce sort/filter, status không chỉ bằng màu (icon/label kèm).

## Stack
> **Triển khai thực tế (2026-07-09):** React + TypeScript · Tailwind v4 · **custom primitives (`src/ui/*`, ~18 component — KHÔNG shadcn/Radix)** · **ECharts** (`echarts` + `echarts-for-react`) cho mọi biểu đồ (bar/donut/line-forecast/funnel/heatmap/sankey/sparkline) · **lucide-react** (icon) · **Geist + Geist Mono** (@fontsource, self-host). TanStack Table (virtualized) + WebSocket/SSE = đợt sau. (Bản gốc dự kiến shadcn/Radix + Recharts/visx — đã thay bằng custom + ECharts.)

## Logo
- **Tên hiển thị:** **AICDP** (AI đậm · CDP nhạt), Geist tracking chặt.
- **Mark "Channel Hub":** lõi trung tâm (AI/CDP) + 6 node quanh = các kênh (email/SMS/Zalo/POS/web/app) kết nối vào lõi — thể hiện **hợp nhất dữ liệu đa kênh**. Tile bo góc gradient indigo→violet; dùng được 16px (favicon) → lớn.
- **File:** `apps/admin-console/public/logo.svg` (lockup), `public/logo-mark.svg` (favicon), component `src/ui/Brand.tsx` (`Logo`, `LogoMark`). (Bản trước: "OCC CDP" + Convergence Node — đã thay.)

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-18 | Khởi tạo design system | /design-consultation; memorable thing "control tower"; research Segment/Tealium/Hightouch/Linear/Vercel |
| 2026-06-18 | Single-family Geist + Geist Mono | Coherence khí cụ + diacritics tiếng Việt + perf (self-host woff2) |
| 2026-06-18 | Accent Signal Teal #0EA5A4 | Khác biệt với xanh/tím SaaS; đọc như công cụ dữ liệu |
| 2026-06-18 | Density theo persona + dark-first war-room | Data-dense không áp đồng nhất; monitoring dùng dark |
| 2026-07-09 | Đổi accent Signal Teal → AIPOWER blue #2563EB | Khớp thương hiệu công ty (aipower.vn); yêu cầu người dùng |
| 2026-07-09 | Personality: Airy modern SaaS (light-first) thay war-room dày đặc | Người dùng chọn cảm giác thoáng/sáng kiểu Segment/Hightouch |
| 2026-07-09 | Custom primitives (Tailwind) + ECharts + lucide + Geist thay shadcn/Recharts | Kiểm soát trực tiếp, ECharts mạnh Sankey/heatmap; brainstorming chốt |
| 2026-07-09 | Logo "OCC CDP" + mark Convergence Node (gradient tile) | Thể hiện hợp nhất định danh xuyên thương hiệu |
| 2026-07-09 | **Rebrand sản phẩm OCC-CDP → AICDP** (bỏ OCC khỏi UI; nhãn "OCC ID"→"AICDP ID"; `occId`/API giữ) | Sản phẩm bán ra dưới tên AICDP; yêu cầu người dùng |
| 2026-07-09 | **Đổi accent → Indigo AI #4F46E5** (gradient indigo→violet), nền mát hơn | "Hiện đại, chuyên nghiệp hơn"; hợp định vị AI của AICDP |
| 2026-07-09 | **Logo mới "Channel Hub"** (lõi + 6 kênh kết nối) | Thể hiện kết nối/hợp nhất nhiều kênh dữ liệu |
| 2026-07-09 | **Dark-first "Slate sâu" + toggle Light/Dark** (mặc định dark, accent indigo #818CF8) | "Tông sậm thể hiện tính kỹ thuật"; ThemeProvider + token override + ECharts runtime |
