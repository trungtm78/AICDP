# Design System — OCH · Customer Data Platform

## Product Context
- **What this is:** Admin console enterprise + exec war-room — **Customer Data Platform** triển khai cho **OCH (One Capital Hospitality)**, hệ sinh thái đa thương hiệu F&B + khách sạn, self-host. Nền tảng do **AIPOWER** phát triển. (Lịch sử tên nội bộ: OCC-CDP → AICDP → mang bộ nhận diện khách hàng OCH, 2026-07-09.)
- **Who it's for:** Data steward, marketer, CSKH, analyst, compliance/DPO, executive (Ban điều hành). Người vận hành 8h/ngày.
- **Space/industry:** Customer Data Platform / MarTech (peers: Segment, Tealium, Hightouch, Amplitude). Tham chiếu UX: Linear, Vercel.
- **Project type:** Data-dense admin web app + realtime executive dashboard.
- **Memorable thing:** "Kiểm soát toàn cục, tức thì" — control tower: mọi số liệu 5 brand realtime, đáng tin, tra cứu 1 khách trong 2 giây.

## Aesthetic Direction
> **Cập nhật triển khai (2026-07-09, rev.3 — bộ nhận diện OCH "Light heritage"):** hệ thống dùng **bộ nhận diện thương hiệu OCH thật** (logo och.vn + màu chủ đạo trích từ logo: **navy `#2E2E40`** + **gủ vàng `#C39851`**). Hướng thực thi = **"Airy modern SaaS + heritage OCH"**: nền kem ấm ("giấy di sản"), card bo góc + shadow nhẹ, accent **navy** cho chữ/nút, **gủ vàng** cho điểm nhấn (gradient navy→gold, vạch heritage, hero). **Mặc định Light** (heritage), giữ toggle Dark ("Slate sâu", accent flip sang gold `#D4A960`). Component = **custom primitives (Tailwind thuần)**; chart = **ECharts** (đọc token runtime → tự đổi theme); icon = **lucide**. Xem "Color", "Stack", "Logo" bên dưới.

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
> **Cập nhật 2026-07-09 (rev.3 — nhận diện OCH):** màu chủ đạo **trích thật từ logo OCH** (och.vn): **navy `#2E2E40`** (accent chính — chữ/nút/focus/link; hover `#3D3D57`, subtle `#ECECEF`) + **gủ vàng `#C39851`** (`--color-gold` — điểm nhấn heritage). Nền **kem ấm** `#F7F6F2`, surface `#FFFFFF`, surface-alt `#F2F0E9`, border ấm `#E7E3DA`. Gradient **navy→gold** `#2E2E40→#4A4763→#C39851` (`.brand-gradient`/`.brand-text`) chỉ ở điểm nhấn (logo/hero/login). Hue biểu đồ (data-viz) dẫn navy+gold: navy `#2E2E40` · gold `#C39851` · aqua `#1baf7a` · blue `#2a78d6` · violet `#7c3aed` · green `#2f7d5b`. Token thực tế xem `apps/admin-console/src/index.css`. (Lịch sử: Signal Teal → AIPOWER blue → Indigo → **OCH navy/gold**.)

- **Approach:** restrained — neutral foundation + 1 accent (navy) + gold điểm nhấn + semantic; gradient chỉ cho brand.
- **Primary (accent):** `#2E2E40` (navy OCH) — action chính, focus, selection, link.
- **Decorative accent:** `#C39851` (gủ vàng OCH) — vạch heritage, gradient, hero; **KHÔNG dùng làm chữ trên nền sáng** (không đạt AA), chỉ trang trí.
- **Neutrals (warm heritage):** bg `#F7F6F2` · surface `#FFFFFF` · surface-alt `#F2F0E9` · border `#E7E3DA` · border-strong `#CFCABD` · text `#1B1B2E` · text-muted `#565564` · text-subtle `#9A968C`.
- **Semantic (ấm hợp heritage):** success `#2F7D5B` · warning `#B4791F` · error `#B3372F` · info `#2E2E40`.
- **Dark mode ("Slate sâu" — toggle, không mặc định):** bg `#0B0F1A` · surface `#141A28` · border `#232C40` · text `#E6E9F0` · **accent flip sang gold `#D4A960`** (navy quá tối để nổi trên nền dark) · accent-fg `#141119` (chữ tối trên nút gold sáng). Data-viz palette sáng hơn cho dark. **Toggle Light/Dark** (Sun/Moon ở topbar), lưu `localStorage["aicdp-theme"]` (**mặc định light** — heritage), set `:root[data-theme]`; token override tại `:root[data-theme="dark"]` (index.css) → component tự đổi. Overlay dùng token `--color-scrim`. ECharts đọc CSS var lúc render → tự đổi theme.
- **Brand-kit:** các thương hiệu OCH (Givral, Kem Tràng Tiền, Fuji, Sunrise/StarCity/Dusit) map vào `--brand-accent` token; brand context badge dùng màu này, KHÔNG ghi đè accent navy của hệ thống.
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
- **Logo OCH thật:** dùng logo chính thức của OCH (tải từ och.vn) — bản navy cho nền sáng, bản trắng cho nền tối. Phụ đề "Customer Data Platform" (Geist, uppercase, tracking rộng) đặt cạnh logo.
- **Theme-aware:** `Brand.tsx` chọn `/och-logo.png` (light) ↔ `/och-logo-light.png` (dark) theo theme hiện tại.
- **Login hero:** ảnh di sản OCH thật (`/och-hero.jpg` từ och.vn) phủ lớp navy→gold + tagline OCH "Creating Legacy — Sharing Value"; ghi "Phát triển bởi AIPOWER".
- **File:** `apps/admin-console/public/{och-logo.png, och-logo-light.png, och-hero.jpg}` + favicon `och-logo.png`; component `src/ui/Brand.tsx` (`Logo`, `LogoMark`). (Bản trước: wordmark "AICDP" + mark "Channel Hub" — đã thay bằng logo OCH thật.)

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
| 2026-07-09 | **Mang bộ nhận diện OCH** (logo och.vn thật + accent **navy #2E2E40** + gủ vàng **#C39851** trích từ logo; "Light heritage" nền kem, **mặc định Light**; dark accent flip → gold #D4A960) | Hệ thống triển khai cho khách hàng OCH — dùng bộ nhận diện thương hiệu thật của OCH; yêu cầu người dùng |
| 2026-07-09 | **Nhãn "AICDP ID" → "OCH ID"** (hiển thị; `occId`/API/DB giữ nguyên) | Đồng bộ nhận diện OCH trên UI |
| 2026-07-09 | **Login split-hero** (ảnh di sản OCH thật + overlay navy→gold + tagline "Creating Legacy — Sharing Value") | Tham chiếu màu + hình nền och.vn; yêu cầu người dùng |
