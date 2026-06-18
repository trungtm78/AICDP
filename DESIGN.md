# Design System — OCC-CDP

## Product Context
- **What this is:** Admin console enterprise + exec war-room cho OCC Customer Data Platform (CDP đa thương hiệu F&B self-host).
- **Who it's for:** Data steward, marketer, CSKH, analyst, compliance/DPO, executive (Ban điều hành). Người vận hành 8h/ngày.
- **Space/industry:** Customer Data Platform / MarTech (peers: Segment, Tealium, Hightouch, Amplitude). Tham chiếu UX: Linear, Vercel.
- **Project type:** Data-dense admin web app + realtime executive dashboard.
- **Memorable thing:** "Kiểm soát toàn cục, tức thì" — control tower: mọi số liệu 5 brand realtime, đáng tin, tra cứu 1 khách trong 2 giây.

## Aesthetic Direction
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
- **Approach:** restrained — neutral foundation + 1 accent "Signal Teal" + semantic.
- **Primary (accent):** `#0EA5A4` — data/precision; dùng cho action chính, focus, selection, link. (dark: `#2DD4BF`)
- **Secondary:** neutral đậm `#334155` cho action phụ; KHÔNG thêm accent thứ 2 (giữ "tín hiệu" hiếm & có nghĩa).
- **Neutrals (cool slate):** bg `#FBFBFC` · surface `#FFFFFF` · surface-alt `#F4F5F7` · border `#E7E9EE` · border-strong `#CBD2DC` · text `#0B0E14` · text-muted `#5B6573` · text-subtle `#8A93A2`.
- **Semantic:** success `#16A34A` · warning `#D97706` · error `#DC2626` · info `#2563EB`.
- **Dark mode (exec war-room, dark-first):** bg `#0A0C10` · surface `#12151C` · surface-alt `#181C24` · border `#232A35` · text `#E6E8EC` · text-muted `#9AA4B2` · accent `#2DD4BF`. Data-viz dark palette RIÊNG (không tái dùng màu chart light); giảm saturation ~12%.
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
React + TypeScript · Tailwind v4 (OKLCH tokens) · shadcn/ui + Radix · TanStack Table (virtualized) · Recharts/visx (+ ECharts cho Sankey/heatmap synergy) · WebSocket/SSE cho realtime.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-18 | Khởi tạo design system | /design-consultation; memorable thing "control tower"; research Segment/Tealium/Hightouch/Linear/Vercel |
| 2026-06-18 | Single-family Geist + Geist Mono | Coherence khí cụ + diacritics tiếng Việt + perf (self-host woff2) |
| 2026-06-18 | Accent Signal Teal #0EA5A4 | Khác biệt với xanh/tím SaaS; đọc như công cụ dữ liệu |
| 2026-06-18 | Density theo persona + dark-first war-room | Data-dense không áp đồng nhất; monitoring dùng dark |
