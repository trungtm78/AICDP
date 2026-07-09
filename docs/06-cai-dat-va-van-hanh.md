# 6. Cài đặt & Vận hành

## 6.1. Yêu cầu

- **PostgreSQL 18** @ `127.0.0.1:5433`, DB `AI_CDP_Pro`, role app `occ_cdp` (KHÔNG dùng `postgres` làm db_user). `bin`: `C:\Program Files\PostgreSQL\18\bin\`.
- **Node.js** + **pnpm** (monorepo).
- (Tùy chọn) **Docker Desktop** cho ClickHouse/Redis/MinIO — Phase A KHÔNG bắt buộc (analytics fallback PG).

## 6.2. Biến môi trường (`.env` — xem `.env.example`)

| Biến | Ý nghĩa |
|------|---------|
| `DATABASE_URL` | `postgres://occ_cdp:occ_cdp_dev@127.0.0.1:5433/AI_CDP_Pro` |
| `CORE_API_PORT` | 8071 |
| `CORE_API_JWT_SECRET` | secret JWT (production: fail-fast nếu yếu) |
| `CLICKHOUSE_URL` / `CLICKHOUSE_DB` | OLAP (tùy chọn) |
| `REDIS_URL` | cache/online store (Phase B) |
| `ANTHROPIC_API_KEY` | **bắt buộc cho tính năng Generative AI** (Trợ lý AI / explain / NL→segment) |
| `OPENAI_API_KEY` / `GEMINI_API_KEY` | provider LLM khác (tùy chọn) |
| `RATE_LIMIT_*` | ngưỡng rate-limit (để trống = tắt) |
| `TRUST_PROXY` | khai báo khi sau LB |

## 6.3. Migration

`db/migrations/001..012` — idempotent (`IF NOT EXISTS`), chạy tự động khi boot / test / seed qua `runMigrations`. Thứ tự theo tên. Migration AI Phase A: **009** customer_feature · **010** view crosswalk · **011** ai_config (append-only) · **012** ai_llm_usage.

> Khi sửa một migration đã chạy (CREATE IF NOT EXISTS không alter): DROP bảng cũ trong DB dev rồi để migration tạo lại.

## 6.4. Chạy dev

```bash
# 1) Seed user admin dev (1 lần) — login admin/admin12345
cd services/core-api && pnpm exec tsx scripts/seed-dev-user.ts

# 2) (khuyến nghị) Seed DỮ LIỆU DEMO — 52 khách, 229 giao dịch, đủ 6 lifecycle
cd services/core-api && pnpm exec tsx scripts/seed-demo.ts
#    ⚠️ CHẠY LẠI sau mỗi lần chạy test — test truncate DB.

# 3) core-api (:8071)
cd services/core-api && CORE_API_PORT=8071 pnpm exec tsx src/main.ts
#    PowerShell: $env:CORE_API_PORT=8071; pnpm exec tsx src/main.ts

# 4) admin-console (:8073)
cd apps/admin-console && pnpm dev
```

Mở `http://localhost:8073/` → đăng nhập `admin` / `admin12345`. Vào **Phân tích chuyên sâu** (`/insights`), **Customers** (Customer 360 + phân tích hành vi AI), **Trợ lý AI**, **AI & Governance**.

## 6.5. Ghi chú kỹ thuật (bẫy thường gặp)

- **admin-console bind `localhost` (::1)** → QA/E2E dùng `http://localhost:8073`. **core-api bind `0.0.0.0`** → dùng `127.0.0.1:8071` (tránh stall IPv6 trên Windows).
- **tsx/esbuild KHÔNG emit decorator metadata** → mọi DI dựa type (guard, Reflector) phải `@Inject` tường minh; verify bằng boot thật (test dùng swc nên có thể xanh nhưng runtime lỗi nếu quên).
- **Generative AI cần `ANTHROPIC_API_KEY`**; thiếu key → `LLM_NOT_CONFIGURED` (các tính năng non-LLM: feature/NBA/forecast/insights/reco vẫn chạy bình thường).
- **Docker máy dev dao động** (engine 500 + port-forward 8123 chập chờn) — Phase A tránh Docker; verify ClickHouse-live khi Docker ổn.

## 6.6. Hạ tầng phụ trợ (Docker)

```bash
docker compose -f infra/docker-compose.dev.yml up -d clickhouse redis minio
curl http://127.0.0.1:8123/ping   # ClickHouse = Ok
```
