# Báo cáo kiểm thử TẦNG CHUYÊN GIA — OCC-CDP (SYSTEM-WIDE)

**Ngày chạy:** 2026-06-18 · **Stack:** TypeScript + vitest, **fast-check** (property/model-based/metamorphic), Postgres 18 thật (`AI_CDP_Pro`). Mutation: **Stryker BLOCKED** (lý do ở mục C) → thay bằng **mutation thủ công có chủ đích** (deterministic).

> Tầng TRÊN UAT. UAT chứng minh "đúng theo ví dụ"; tầng này chứng minh **bất biến giữ trên cả miền input** (hàng nghìn case sinh ngẫu nhiên) và **bộ test thật sự bắt được bug** (mutation).

## A. Công cụ
- `fast-check@4` — property-based + model-based (chuỗi lệnh ngẫu nhiên) + metamorphic.
- vitest (recipe dự án: `pnpm exec vitest run`), Postgres thật qua `test-helpers/db` (setup + truncate).
- Stryker@9 + vitest-runner: cài được nhưng **không chạy được** trong môi trường này (xem C).

## B. Property / Model-based / Metamorphic — KẾT QUẢ

**Asset:** `services/core-api/src/expert/expert.spec.ts` (14 test) + `src/expert/normalize.prop.spec.ts` (5 test). **Tổng 19/19 PASS.**

| ID | Phương pháp | Bất biến chứng minh | numRuns | Kết quả |
|----|-------------|---------------------|---------|---------|
| PB-08 | property | mọi biểu diễn SĐT (0../+84../84.. + space/dấu) → cùng `+84<national>`; idempotent | 200–300 | ✅ |
| PB-08b | property | số sai prefix/độ dài → null | 100 | ✅ |
| PB-09 | property | email lowercase+trim, idempotent; thiếu @/domain → null | 200–300 | ✅ |
| PB-10 | property | normalize KHÔNG ném exception trên chuỗi bất kỳ | 500 | ✅ |
| PB-10b | ví dụ | isStrong đúng theo loại định danh | — | ✅ |
| PB-01 | property (DB) | n earn → available = Σpoints, reserved=0 | 25 | ✅ |
| PB-04 | property (DB) | earn idempotent (cùng key+points) → +1 lần | 20 | ✅ |
| PB-05 | property (DB) | earn cùng key + points khác → IDEMPOTENCY_CONFLICT, không ghi | 20 | ✅ |
| **PB-06/SF-02** | **model-based (DB)** | **chuỗi lệnh ngẫu nhiên (≤14 bước): model balance khớp + available/reserved ≥0 mọi bước + Σdelta=0** | 15 | ✅ |
| MR-07 | metamorphic (DB) | reserve(R) rồi release → available không đổi (đảo nghịch) | 20 | ✅ |
| SF-01 | model (DB) | capture sau captured → RESERVATION_INVALID_STATE; release sau capture → chặn | — | ✅ |
| PB-11 | property (DB) | cùng identifier → luôn cùng occId (deterministic) | 20 | ✅ |
| MR-06 | metamorphic (DB) | hoán vị thứ tự identifier → cùng occId | 15 | ✅ |
| PB-14 | property (DB) | occ chưa ghi consent → isAllowed=false (deny-by-default) | 20 | ✅ |
| PB-15 | property (DB) | chuỗi granted/withdrawn → isAllowed == (bản cuối==granted) (latest-wins) | 20 | ✅ |
| PB-13 | property (DB) | activation: total=allowed+suppressed; allowed⊆input; chỉ granted được gửi | 15 | ✅ |

**Điểm mạnh:** bất biến double-entry (Σdelta=0 + cấm âm) và deny-by-default được chứng minh trên **chuỗi thao tác ngẫu nhiên**, không chỉ ví dụ tay — đây là mức đảm bảo cao nhất cho correctness tiền/consent. fast-check tự shrink nếu gặp counterexample; không có counterexample nào → bất biến vững.

## C. MUTATION TESTING

### Stryker — BLOCKED (ghi rõ, không giả vờ chạy)
Stryker@9 + @stryker-mutator/vitest-runner cài thành công, instrument được 104 mutant trên `normalize.ts`, NHƯNG worker process không resolve được plugin `vitest` qua **pnpm symlink + sandbox** ("Cannot find TestRunner plugin vitest"); bật `inPlace` thì restore lỗi **EPERM rename trên Windows** (file lock) khiến phải khôi phục thủ công bằng git. Đây là vấn đề tương thích môi trường (pnpm workspace + Windows), không phải lỗi hệ thống. → Chuyển sang mutation thủ công có chủ đích cho các invariant nguy hiểm nhất.

### Mutation thủ công — KẾT QUẢ (mỗi mutant: chèn lỗi → chạy spec phủ → kỳ vọng RED = killed)

| ID | Module | Mutant tiêm vào code | Spec phủ | Kết quả |
|----|--------|----------------------|----------|---------|
| MT-03a | identity/normalize | prefix mobile VN `[35789]`→`[0-9]` (chấp nhận số sai) | normalize.prop | ✅ **KILLED** |
| MT-03b | identity/normalize | bỏ `.toLowerCase()` ở email | normalize.prop | ✅ **KILLED** |
| MT-01 | loyalty.service | vô hiệu guard `if (avail < 0)`→`if (false)` (cho over-reserve) | expert Loyalty | ✅ **KILLED** |
| MT-05 | consent.service | đảo deny-by-default `=== "granted"`→`!== "granted"` | expert Consent | ✅ **KILLED** |
| MT-07 | http/auth/roles.guard | bỏ deny-by-default → luôn `return true` | auth.e2e.spec | ✅ **KILLED** |

**Kill-rate trên tập mutant nguy hiểm (tiền/danh-tính/consent/RBAC): 5/5 = 100%** — đạt mục tiêu catalog (100% cho module lõi). Mỗi mutant là một thay đổi code đủ gây sai tiền/sai danh tính/lộ quyền/gửi sai consent; bộ test bắt được tất cả. Sau mỗi mutant đều `git checkout` khôi phục; cây nguồn sạch.

## D. Đánh giá UI/UX (lens thứ 10)
Hệ thống UI đã được quan sát thật qua UI E2E (14 test Chromium ở vòng UAT) đi qua 8 workspace + 3 luồng data-flow. Phát hiện UX đã ghi ở `docs/uat/system-wide/uat_report.md` mục "Quan sát UX" và `uat_system-wide.md` S13 (UX-01..06): chủ yếu là thiếu deep-link giữa workspace (phải dán lại occId), segment↔activation phải copy tay, reservation mất khi reload. Không có lỗi UX gây SAI nghiệp vụ/mất tiền → không chặn release; là hạng mục cải thiện trải nghiệm.

## E. Độ phủ bất biến

| Bất biến (W1) | Có property/model test xanh? | Mutation xác nhận? |
|---------------|------------------------------|--------------------|
| Loyalty Σdelta=0 + cấm âm | ✅ PB-06/SF-02 | ✅ MT-01 |
| Loyalty idempotency | ✅ PB-04/05 | (gián tiếp) |
| Loyalty state machine một chiều | ✅ SF-01 | (gián tiếp) |
| Identity normalize idempotent + đa biểu diễn | ✅ PB-08/09 | ✅ MT-03a/b |
| Identity resolve deterministic + hoán vị | ✅ PB-11/MR-06 | — |
| Consent deny-by-default + latest-wins | ✅ PB-14/15 | ✅ MT-05 |
| Activation bảo toàn đếm | ✅ PB-13 | — |
| RBAC deny-by-default | (qua e2e UAT) | ✅ MT-07 |
| **Hổng (chưa phủ tầng expert):** concurrency race thật (PF-02/03), fuzzing parser (FZ), differential CH vs PG, performance quy mô lớn | ❌ | ❌ |

## F. Nhận định chuyên gia + GO/NO-GO

**Điểm mạnh:**
- Các bất biến correctness rủi ro cao nhất (double-entry, deny-by-default, idempotency, resolve deterministic) được chứng minh trên MIỀN input rộng bằng property + model-based, không chỉ ví dụ.
- Mutation 100% kill trên đúng các điểm nguy hiểm (tiền/danh-tính/consent/RBAC): bộ test KHÔNG mù ở những chỗ quan trọng nhất.

**Đã bổ sung — CONCURRENCY RACE (PF-02/03):** `src/expert/concurrency.spec.ts` **3/3 PASS** chứng minh dưới ĐỒNG THỜI thật (Promise.allSettled trên Postgres): (a) 20 ingest cùng `{brand}:{store}:{pos_txn}` → đúng 1 canonical_transaction, cùng occId, đúng 1 created (idempotent race-free); (b) earn 100 + 10 reserve(40) song song → tối đa 2 thành công, available KHÔNG âm, reserved=40×success (advisory lock chống oversell); (c) 15 earn song song keys khác → tổng đúng 150 (không lost-update).

**Đã bổ sung — FUZZING (FZ):** `src/expert/fuzz.spec.ts` **7/7 PASS** — fuzz `validate()` trên 5 schema (orderCompleted/identify/loyaltyEarn/activation/consent) với `fc.anything()` (500 run/schema) + total méo (NaN/Infinity/1e309/âm/chuỗi) + occ_timestamp rác: với MỌI input, validate() hoặc trả data hợp lệ, hoặc ném `AppError` code `SCHEMA_*` — KHÔNG rò ZodError/TypeError/crash.

**Đã bổ sung — PERFORMANCE quy mô (PF-04/06):** `src/expert/perf.spec.ts` **4/4 PASS** trên dataset **400 khách** thật: lookup Customer 360 **p95=7.2ms** (avg 4.7ms, ngưỡng <300ms); segment preview **4.3ms** (count=400, ngưỡng <1500ms); getBalance **3.2ms** (<200ms). Độ trễ thao tác chính dưới ngưỡng user-perceivable rất xa.

**Điểm yếu / rủi ro còn lại (đều là follow-up CI/Docker, KHÔNG chặn GĐ1):**
1. **Stryker kill-rate TOÀN CỤC tự động** chưa đo (tooling blocked trên pnpm/Windows) — chạy trên CI Linux (node-linker hoisted). Mutation chủ đích 5/5 đã phủ các điểm nguy hiểm nhất.
2. **Differential CH vs PG** (DF-02) chờ ClickHouse-live (Docker blocked).
3. Perf ở quy mô rất lớn (≥100k, concurrency cao) và load-test chuyên sâu (k6) là việc của giai đoạn pre-production.

### Bảng quyết định release
| Tiêu chí | Ngưỡng | Thực tế | Đạt? |
|----------|--------|---------|------|
| Property mọi bất biến lõi xanh | 100% | 19/19 | ✅ |
| Mutation kill (module lõi, tập nguy hiểm) | ≥80% | 100% (5/5) | ✅ |
| Stateful: transition bất hợp lệ bị chặn | 100% | ✅ (SF-01/02) | ✅ |
| Concurrency race (idempotency + no-oversell) | 0 oversell/dup | ✅ (PF-02/03, 3/3) | ✅ |
| Fuzz parser không crash | 0 crash | ✅ (FZ, 7/7) | ✅ |
| Perf thao tác chính (dataset 400) | < ngưỡng | ✅ p95 7.2ms / 4.3ms / 3.2ms | ✅ |
| Mutation kill (module lõi, tập nguy hiểm) | ≥80% | ✅ 100% (5/5 thủ công) | ✅ |
| Mutation kill-rate TOÀN CỤC tự động | ≥80% | chưa đo (Stryker blocked → CI Linux) | ⚠️ follow-up |
| UX: không lỗi nặng chặn nghiệp vụ | 0 | 0 | ✅ |
| **Khuyến nghị** | | | **GO (GĐ1)** |

**GO (GĐ1):** correctness lõi (tiền/danh-tính/consent/RBAC) chứng minh vững bằng property + model-based + concurrency-race + mutation chủ đích 100%; biên parse an toàn (fuzz); hiệu năng thao tác chính dưới ngưỡng. Tổng **expert 33/33 PASS** + full suite core-api 173/173. Follow-up KHÔNG chặn GĐ1: Stryker full kill-rate trên CI Linux; differential CH vs PG khi Docker ổn; load-test pre-production.

## G. CI gate (đề xuất)
Chạy property suite mỗi PR; Stryker (full) định kỳ trên Linux runner (tránh lỗi pnpm/Windows), chặn merge nếu kill-rate module lõi < 80%:
```yaml
# .github/workflows/expert-test.yml (phác thảo)
jobs:
  property:
    runs-on: ubuntu-latest
    services: { postgres: { image: postgres:18, ports: ["5433:5432"], env: { POSTGRES_PASSWORD: postgres } } }
    steps:
      - run: pnpm i && cd services/core-api && pnpm exec vitest run src/expert/
  mutation:   # nightly
    runs-on: ubuntu-latest
    steps:
      - run: cd services/core-api && pnpm exec stryker run   # node-linker=hoisted để fix plugin resolution
```
