# 5. Kiểm thử

Chất lượng chứng minh được, không phải "chạy xanh là xong". Nhiều tầng, cross-model review, chạy thật trên Postgres.

## 5.1. Số liệu

| Bộ | Kết quả | Ghi chú |
|----|---------|---------|
| **UAT system-wide** | **78/78 PASS** | API smoke gate 64 + UI E2E Chromium 14 |
| **Expert test** | **33/33 PASS** | property/model-based + concurrency + fuzz + perf |
| **Mutation** (chủ đích) | **5/5 KILLED** | 100% module tiền/danh-tính/consent/RBAC |
| **core-api** | **240 test** | unit + integration + e2e (TDD) |
| **admin-console** | 25 unit + Playwright E2E | component + UI thật |

Chi tiết: [`uat/system-wide/`](./uat/system-wide/) · [`expert-test/system-wide/`](./expert-test/system-wide/).

## 5.2. UAT system-wide (2 lớp)

- **Lớp 1 — API smoke gate** (`apps/admin-console/e2e-api/system.api.spec.ts`): risk-based P0 trên 11 module — auth/RBAC deny-by-default, ingestion idempotency + hợp nhất xuyên brand, loyalty double-entry, consent gate, activation, journey, analytics, AI.
- **Lớp 2 — UI E2E Chromium** (qua DOM thật, KHÔNG seed data qua API cho UI): login, Customer 360, master data qua form, loyalty, consent, activation.

## 5.3. Expert test (tầng chuyên gia)

`services/core-api/src/expert/` — **fast-check** (property/model-based) trên Postgres thật:
- **Property/model-based** (19): loyalty Σdelta=0 + cấm âm qua chuỗi lệnh ngẫu nhiên; normalize đa biểu diễn phone E.164/email; consent deny-by-default + latest-wins; activation bảo toàn đếm; identity resolve deterministic.
- **Concurrency-race** (3): ingest idempotency 20 luồng; reserve chống oversell; earn no-lost-update.
- **Fuzzing** (7): `validate()` không crash trên mọi input.
- **Performance** (4): dataset 400 khách — lookup p95 ~7ms, segment ~4ms.
- **Mutation** (Stryker + thủ công): chứng minh bộ test bắt được bug (đổi guard/logic → test phải RED).

## 5.4. Quy trình mỗi task (bắt buộc)

1. **TDD** (RED → GREEN → REFACTOR).
2. **verification-before-completion** (chạy tsc + suite, xác nhận output).
3. **Cross-model review:** `/review` (nội bộ) → `/codex` (GPT độc lập).
4. **`/qa`** — E2E thật bằng Playwright/Chromium click qua UI (cấm seed/đăng ký data qua API/function).
5. **Milestone:** `/plan-eng-review` đối chiếu spec; `/uat-test-writer-web`→`/uat-test-runner-web`; toàn hệ thống: `/expert-test-writer`→`/expert-test-runner`.
6. Commit **Conventional Commits** mỗi task; không push trừ khi được yêu cầu.

## 5.5. Lệnh chạy

```bash
# core-api
cd services/core-api && pnpm test                          # toàn bộ (240)
pnpm exec vitest run src/expert/                           # tầng chuyên gia
pnpm exec vitest run --config vitest.mut.config.ts         # (mutation config)

# admin-console
cd apps/admin-console && pnpm test                         # unit
npx playwright test --config e2e-api/playwright.api.config.ts   # API smoke gate
npx playwright test                                        # UI E2E (cần 2 server + dev user)
```
