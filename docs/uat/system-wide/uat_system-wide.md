# UAT SYSTEM-WIDE — Hệ thống OCC-CDP

> Bộ kiểm thử chấp nhận (UAT) toàn hệ thống theo chuẩn ISO/IEC/IEEE 29119 + ISTQB, rủi ro-driven.
> Stack: **NestJS core-api** (`:8071`) + **React admin-console** (`:8073`) + **PostgreSQL 18** (`127.0.0.1:5433`, DB `AI_CDP_Pro`) + ClickHouse/Redis/MinIO.
> Toàn bộ output bằng tiếng Việt; thuật ngữ kỹ thuật (endpoint, status code, field name, mã lỗi) giữ nguyên tiếng Anh.
> Phần kế hoạch là **S1–S8**; phần case chi tiết bắt buộc là **S9** (mỗi module một khối feature-level đầy đủ).

---

## S1. Bản đồ hệ thống & phạm vi UAT

| Mục | Nội dung |
|-----|----------|
| **Tên hệ thống** | OCC-CDP — Customer Data Platform enterprise self-host cho tập đoàn F&B đa thương hiệu OCC |
| **Loại hệ thống** | CDP nội bộ B2B (ingestion + identity resolution + loyalty + consent + activation + analytics + AI), audit-grade hướng IPO |
| **Các actor/role** | `admin` (toàn quyền), `data_steward` (master data), `marketer` (activation/journey/segment/AI/analytics), `csr` (loyalty/consent/lookup), `analyst` (analytics/segment/AI/lookup/balance), `compliance` (consent), `executive` (analytics/lookup read-only), `connector` (ingestion service-to-service). Persona vận hành qua admin-console: admin, data_steward, marketer, csr, analyst, compliance, executive. |
| **Danh sách module (11 bounded context)** | 1. Auth/Login/JWT/Platform (user+API key) · 2. Ingestion (POS/connector) · 3. Identity / Customer 360 · 4. Loyalty (double-entry) · 5. Consent (Governance) · 6. Activation (Audiences) · 7. Segment · 8. Journey · 9. Analytics / Control Tower · 10. AI cross-sell · 11. Master Data (Data Ops) |
| **8 workspace UI** | Control Tower · Customers · Audiences · Journeys · Loyalty · Data Ops · Governance · Platform (+ màn Đăng nhập) |
| **Phạm vi UAT (in scope)** | Toàn bộ API `core-api` (`/v1/*`) + toàn bộ 8 workspace admin-console + các journey E2E xuyên module. Auth (JWT + API key), RBAC deny-by-default, rate-limit, error envelope, consent chokepoint. |
| **Ngoài phạm vi (out of scope)** | (a) **ClickHouse-live OLAP** — code xong nhưng chưa verify live do Docker dev dao động; analytics có fallback PG nên vẫn test được qua PG. (b) RudderStack self-host wiring (giai đoạn sau). (c) Rate-limit distributed/Redis (hiện in-memory per-process). (d) Hạ tầng K8s/TLS/WAF production. (e) Load/stress test chuyên sâu (k6/JMeter riêng) — UAT chỉ verify ngưỡng user-perceivable. |
| **Giả định về hệ thống (cần PO xác nhận)** | (1) Dev seed user `admin/admin12345` role admin tồn tại. (2) 5 brand đã seed (Givral, Kem Tràng Tiền, Hải Hà Kotobuki, Fuji Foods, Origato). (3) JWT hết hạn theo `expiry` trả về khi login. (4) Activation `occIds` tối đa 100.000. (5) Loyalty point là số nguyên an toàn, cấm âm. (6) Ingestion idempotency key = `{brand}:{store}:{pos_transaction_id}`. |

---

## S2. Phụ thuộc & thứ tự test module

| Thứ tự | Module | Phụ thuộc vào | Lý do test trước | Master data / điều kiện cần sẵn |
|--------|--------|---------------|------------------|---------------------------------|
| 1 | **Auth / Login / Platform** | (nền tảng) | Mọi UI cần đăng nhập; mọi API cần token/API key; RBAC chặn tất cả | Dev admin user; JWT secret cấu hình |
| 2 | **Master Data (Data Ops)** | Auth | Ingestion cần brand/store/product tồn tại; sku-mapping để resolve sản phẩm | 5 brand seed; role data_steward |
| 3 | **Ingestion** | Auth, Master Data | Sinh occ_id + canonical_transaction — nguồn dữ liệu cho mọi module sau | API key role `connector`; brand/store hợp lệ |
| 4 | **Identity / Customer 360** | Ingestion | Hợp nhất định danh xuyên brand; nền cho lookup, segment, loyalty, AI | Đã ingest ≥1 đơn có identifiers |
| 5 | **Loyalty** | Identity | Earn/reserve theo occId; balance là projection | occId hợp lệ từ ingestion |
| 6 | **Consent (Governance)** | Identity | Ghi consent theo occId; deny-by-default; nền cho activation gate | occId hợp lệ |
| 7 | **Segment** | Ingestion, Identity | Lọc occId theo chi tiêu/giao dịch — feed cho activation & journey | Đã có giao dịch để segment khớp |
| 8 | **Activation** | Consent, Segment, Identity | Chokepoint consent DUY NHẤT; lọc occId chưa cấp consent | occIds + consent đã ghi |
| 9 | **Journey** | Segment, Activation, Loyalty, Consent | Orchestration: segment → (loyalty_bonus \| activation gate consent) | Các module 5–8 chạy được |
| 10 | **Analytics / Control Tower** | Ingestion, Loyalty, Activation | Projection KPI từ dữ liệu các module trên | Đã có giao dịch/điểm/activation |
| 11 | **AI cross-sell** | Ingestion (items) | Collaborative filtering từ `canonical_transaction.items` | Đã ingest đơn có `items` |

**Master data nền bắt buộc seed trước mọi journey:** 5 brand; ≥2 store/brand; ≥3 product + sku-mapping; ≥1 API key `connector`; user đủ 7 persona role; ≥1 occ_id có nhiều identifier xuyên brand.

---

## S3. Ma trận tích hợp module (Integration Matrix)

| Module nguồn | Module đích | Dữ liệu bàn giao | Điều cần verify | Ưu tiên |
|--------------|-------------|------------------|-----------------|---------|
| Ingestion | Identity | identifiers → occ_id | Cùng identifier ra cùng occ_id; idempotent không tạo trùng | P0 |
| Ingestion | Canonical Transaction | properties.total, items, pos_transaction_id | Idempotency key `{brand}:{store}:{pos_txn}` không tạo đơn trùng | P0 |
| Ingestion | Identity (identify) | traits (full_name…) | Survivorship COALESCE không ghi đè giá trị có sẵn bằng null | P1 |
| Identity | Customer 360 / Loyalty / Segment / Consent / AI | occId | Mọi module tham chiếu cùng occId hợp nhất; lookup ra đúng hồ sơ | P0 |
| Loyalty (reserve) | Loyalty (capture/release) | reservationId | State machine held→captured\|released; cấm capture 2 lần | P0 |
| Segment | Activation | occIds[] | Số occId preview = số đưa vào activation; không rớt | P0 |
| Consent | Activation | allowed (per occId, purpose) | occId chưa granted bị suppress (deny-by-default) | P0 |
| Activation | Activation Run | runId, allowed/suppressed count | total = allowed + suppressed; run truy vấn lại đúng | P0 |
| Segment | Journey | segmentCriteria | Journey run trúng đúng tập đối tượng segment khớp | P1 |
| Journey (activation) | Consent | purpose | Journey activation vẫn gate consent (không bypass) | P0 |
| Journey (loyalty_bonus) | Loyalty | points, idempotencyKey `journey:{runId}:{occId}` | Chạy journey 2 lần không cộng điểm trùng | P0 |
| Ingestion/Loyalty/Activation | Analytics | đếm txn, revenue, điểm, activation | KPI Control Tower phản ánh đúng dữ liệu thực | P1 |

---

## S4. Danh mục User Journey toàn hệ thống (E2E)

| JID | User journey | Module đi qua | Actor | Ưu tiên | Loại |
|-----|--------------|---------------|-------|---------|------|
| J01 | POS ingest đơn → khách được định danh → CSR tra cứu Customer 360 thấy đúng | Auth → Ingestion → Identity → Customers | connector + csr | P0 | Happy |
| J02 | Hợp nhất xuyên thương hiệu: 2 đơn 2 brand cùng số điện thoại → 1 OCC ID | Ingestion → Identity → Customers | connector + csr | P0 | Cross-brand |
| J03 | Vòng đời loyalty: earn → reserve → capture (đổi quà) cho 1 đơn giữ | Auth → Loyalty | csr | P0 | Happy |
| J04 | Vòng đời loyalty rollback: reserve → release (hủy đổi) trả lại điểm | Auth → Loyalty | csr | P0 | Rollback |
| J05 | Consent gate activation: khách KHÔNG cấp consent → activation suppress | Identity → Consent → Segment → Activation | compliance/csr + marketer | P0 | Cross-role |
| J06 | Consent gate activation: khách CÓ cấp consent → activation gửi | Consent → Segment → Activation | csr + marketer | P0 | Happy |
| J07 | Journey loyalty_bonus: segment khách VIP → thưởng điểm hàng loạt | Segment → Journey → Loyalty | marketer | P0 | Happy |
| J08 | Journey activation gate consent: chạy 2 lần không cộng/gửi trùng | Journey → Loyalty/Consent/Activation | marketer | P0 | Idempotent |
| J09 | Admin tạo user role mới → user đăng nhập → chỉ thấy phần được phép | Platform → Login → RBAC | admin + persona | P0 | Cross-role |
| J10 | Admin tạo API key connector → connector ingest đơn thành công | Platform → Ingestion | admin + connector | P0 | Cross-role |
| J11 | Khách rút consent giữa chừng → activation lần sau bị suppress | Consent → Activation | csr + marketer | P0 | Interrupted |
| J12 | Executive xem Control Tower phản ánh đúng dữ liệu vừa ingest/activate | Ingestion → Analytics | executive | P1 | Happy |
| J13 | Bảo mật xuyên hệ thống: user role csr cố gọi endpoint admin/marketer → 403 | mọi module | csr | P0 | Security |

---

## S5. Vòng đời dữ liệu (Data Lifecycle)

### S5.1. Vòng đời OCC ID (định danh khách hàng)

| Giai đoạn | Module phụ trách | Trạng thái | Điều cần verify khi chuyển tiếp |
|-----------|------------------|-----------|--------------------------------|
| Tạo | Ingestion (order_completed/identify) | occ_id mới | identifier chuẩn hóa (phone E.164 VN…) trước khi resolve; UNIQUE(type, value_normalized) |
| Hợp nhất | Identity resolve | occ_id gộp | Cùng identifier ra cùng occ_id; advisory lock race-free; merge non-destructive (mapping/version) |
| Tra cứu | Customer 360 | (read) | resolved_identifier→occ_id không traverse graph runtime; trả 404 nếu chưa gắn |
| Làm giàu | Identify (traits) | profile cập nhật | Survivorship COALESCE: không ghi đè tên đã có bằng null |

### S5.2. Vòng đời điểm Loyalty (double-entry)

| Giai đoạn | Module | Trạng thái | Điều cần verify |
|-----------|--------|-----------|-----------------|
| Cộng | earn | balance tăng | sum(delta)=0 (double-entry); idempotencyKey unique; cấm điểm ≤0 |
| Giữ | reserve | held | available = balance − reserved; cấm reserve quá available |
| Chốt | capture | captured | held→captured một chiều; cấm capture 2 lần (RESERVATION_INVALID_STATE) |
| Hủy giữ | release | released | held→released; trả lại available; cấm release sau capture |
| Số dư | projection | (read) | balance = projection từ ledger, KHÔNG cột mutable; cấm âm |

### S5.3. Vòng đời Consent (append-only)

| Giai đoạn | Module | Trạng thái | Điều cần verify |
|-----------|--------|-----------|-----------------|
| Ghi cấp | POST /consent granted | granted | append-only (trigger DB chặn UPDATE/DELETE); latest-wins |
| Rút | POST /consent withdrawn | withdrawn | bản ghi mới, không sửa bản cũ; check trả allowed=false |
| Kiểm | GET /consent/check | (read) | deny-by-default: không có granted → allowed=false |
| Áp dụng | Activation/Journey | (gate) | chỉ activation gate; ingestion & loyalty LUÔN nhận |

### S5.4. Vòng đời Activation Run

| Giai đoạn | Module | Trạng thái | Điều cần verify |
|-----------|--------|-----------|-----------------|
| Tạo | POST /activation | running | ghi activation_run + activation_member per occId |
| Quyết định | consent gate | allowed/suppressed | decision = allowed \| suppressed_no_consent; total = allowed + suppressed |
| Hoàn tất | (đồng bộ) | completed | GET /activation/{runId} trả đúng số liệu; không sửa run đã chạy |

---

## S6. Kiểm thử phi chức năng mức hệ thống

| Khía cạnh | Điều cần verify | Ưu tiên |
|-----------|-----------------|---------|
| Tải đồng thời | 10–20 request đồng thời chạy lookup/earn/ingest không lỗi/chậm bất thường (<3s) | P1 |
| Toàn vẹn dữ liệu (race) | Ingest cùng `{brand}:{store}:{pos_txn}` đồng thời → 1 đơn duy nhất (idempotent); reserve đồng thời không cho âm/oversell điểm | P0 |
| Phân quyền chéo toàn hệ thống | Mỗi role chỉ truy cập đúng endpoint của mình trên TẤT CẢ module; deny-by-default kể cả route quên @Roles | P0 |
| Consent chokepoint | Chỉ activation gate consent; ingestion & loyalty LUÔN ghi nhận dù khách chưa cấp consent | P0 |
| Khôi phục sự cố | ClickHouse lỗi → analytics fallback PG + circuit breaker (không sập endpoint) | P1 |
| Phiên & bảo mật | Token hết hạn/đổi role/disable user → có hiệu lực ngay (role đọc lại từ DB mỗi request); logout xóa session; JWT cũ sau logout → 401 | P0 |
| Rate-limit chống burst | Vượt ngưỡng → 429 + `Retry-After`; login/public theo IP chống brute force | P0 |
| Error envelope không nuốt data | Mọi lỗi trả envelope đầy đủ `{code,message,why,fix,field_path,correlation_id,retryable,...}`; không 500 trần | P0 |
| **Nhất quán UI/UX xuyên hệ thống** | 8 workspace cùng App shell; UX State Contract (idle/loading/error/notfound/empty/success) nhất quán; format số `vi-VN`; nút hành động, badge trạng thái đồng bộ | P1 |

---

## S7. Bộ Smoke & Regression toàn hệ thống

**Smoke test (chạy mỗi lần deploy — hệ thống "còn sống"):**

| ID | Kiểm tra nhanh | Module |
|----|----------------|--------|
| SMK-01 | `GET /v1/health` trả `{status:"ok"}` | Health |
| SMK-02 | Đăng nhập admin-console bằng admin/admin12345 vào được Control Tower | Auth |
| SMK-03 | Control Tower load KPI không lỗi | Analytics |
| SMK-04 | `POST /v1/ingest` 1 đơn test (API key connector) → 202 | Ingestion |
| SMK-05 | Customer 360 lookup occId/identifier vừa ingest → ra hồ sơ | Identity |
| SMK-06 | Data Ops hiển thị 5 brand từ API | Master Data |

**Regression (bắt buộc pass mỗi release):** = toàn bộ journey P0 ở S4 (J01–J11, J13) + tích hợp P0 ở S3 + 100% case P0 ở S9 + bộ test tự động hiện có (core-api 119 unit/integration, admin-console 25 unit + 11 Playwright E2E).

---

## S8. Kế hoạch ưu tiên theo rủi ro & Câu hỏi cho PO/BA

**Thứ tự thực thi UAT đề xuất (rủi ro cao test trước):**

1. **Auth/RBAC/rate-limit** — fail = lộ dữ liệu/leo thang quyền toàn hệ thống.
2. **Consent chokepoint + Activation gate** — fail = gửi marketing tới khách chưa đồng ý (rủi ro pháp lý/IPO).
3. **Loyalty double-entry** — fail = sai điểm/sai tiền, double-spend, balance âm.
4. **Ingestion idempotency + Identity resolve** — fail = nhân bản đơn/sai danh tính (đúng tiền/đúng danh tính tại POS).
5. **Journey idempotency** — fail = cộng điểm/gửi activation trùng.
6. **Segment/Analytics/AI/Master Data** — sai số liệu hoặc thiếu nhất quán, ít rủi ro mất tiền.

**Câu hỏi cần PO/BA xác nhận trước/khi khoan sâu:**

1. JWT TTL chính xác bao lâu? (giả định theo `expiry` server trả). Có refresh token không (hiện chưa)?
2. Rate-limit ngưỡng production cụ thể (`RATE_LIMIT_*_BURST`)? Hiện opt-in, để trống = tắt.
3. Loyalty: trần điểm tối đa mỗi giao dịch? Reservation có TTL tự release không?
4. Consent: 5 purpose hiện đủ chưa? Có purpose bắt buộc theo luật (PDPD VN) cần mặc định deny cứng?
5. Activation: ngưỡng 100.000 occId/run có đúng SLA? Vượt thì chia batch hay reject?
6. Customer 360 lookup chỉ hỗ trợ 4 loại định danh trên UI (phone/email/loyalty_card/pos_member_id) — có cần thêm web/app anonymous id lên UI?
7. Master Data: brand chỉ đọc trên UI (không tạo brand qua UI) — đúng chủ đích?

---

> **Phần dưới đây (S9) là TRỌNG TÂM — test case chi tiết feature-level cho TỪNG module, theo thứ tự rủi ro S8. Mỗi module là một khối hoàn chỉnh.**

---

# S9. TEST CASE CHI TIẾT THEO MODULE

**Quy ước cột:** `Loại` ∈ {GREEN, RED, EDGE, BOUNDARY, SECURITY, DATA, PERFORMANCE, UI_CONSISTENCY, E2E}. `ƯT` = độ ưu tiên (P0/P1/P2). Mỗi case có Tiền đề, Bước, Dữ liệu, Kết quả mong đợi; cột **Kết quả thực tế / Trạng thái** QA điền khi chạy (để trống). Endpoint test trực tiếp dùng token/API key đúng role; case UI test qua admin-console.

---

## S9.1. Module 1 — Auth / Login / RBAC / Rate-limit / Platform (ƯT cao nhất)

**Bề mặt:** `POST /v1/auth/login`, JWT + API key Bearer, RolesGuard deny-by-default, RateLimitGuard/IpRateLimitGuard, Platform CRUD user + API key (`/v1/auth/users*`, `/v1/auth/api-keys*`), màn Đăng nhập + workspace Platform.

### Ma trận truy vết — Module 1

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| AUTH-001 | GREEN | P0 | Đăng nhập đúng admin/admin12345 → JWT + vào Control Tower |
| AUTH-002 | RED | P0 | Đăng nhập sai mật khẩu → 401, message không tiết lộ lý do |
| AUTH-003 | RED | P0 | Đăng nhập username không tồn tại → 401 (chống user enumeration, cùng message + thời gian dummy-hash) |
| AUTH-004 | RED | P0 | Login thiếu username/password → 400 SCHEMA_MISSING_REQUIRED_FIELD |
| AUTH-005 | SECURITY | P0 | Gọi endpoint bất kỳ KHÔNG có Authorization → 401 UNAUTHENTICATED |
| AUTH-006 | SECURITY | P0 | Token sai chữ ký / alg-confusion (alg=none) → 401, không chấp nhận |
| AUTH-007 | SECURITY | P0 | JWT hết hạn → 401 (không phải 403) |
| AUTH-008 | SECURITY | P0 | API key Bearer hợp lệ (role connector) gọi /v1/ingest → cho phép |
| AUTH-009 | SECURITY | P0 | API key đã revoke → 401 |
| AUTH-010 | SECURITY | P0 | RBAC: role `csr` gọi endpoint admin (`GET /v1/auth/users`) → 403 FORBIDDEN |
| AUTH-011 | SECURITY | P0 | RBAC deny-by-default: route nội bộ không khai @Roles → 403 với role thường (admin vẫn qua) |
| AUTH-012 | SECURITY | P0 | Đổi role/disable user trong DB → request kế tiếp của user đó áp role mới ngay (đọc role từ DB mỗi request) |
| AUTH-013 | DATA | P1 | Username có khoảng trắng đầu/cuối, hoa-thường → xử lý nhất quán (không tạo 2 tài khoản "Admin"/"admin") |
| AUTH-014 | BOUNDARY | P1 | Username 2 ký tự (dưới min 3) khi tạo user → 400; 3 ký tự → OK |
| AUTH-015 | BOUNDARY | P1 | Password 7 ký tự (dưới min 8) khi tạo user → 400; 8 ký tự → OK |
| AUTH-016 | PERFORMANCE | P1 | Login phản hồi < 3s; 10 login đồng thời không lỗi |
| AUTH-017 | SECURITY | P0 | Rate-limit login theo IP: vượt `RATE_LIMIT_PUBLIC_BURST` → 429 + Retry-After (chống brute force) |
| AUTH-018 | SECURITY | P0 | Rate-limit per-principal: vượt `RATE_LIMIT_SOURCE_BURST` → 429; key theo principalId không theo tên |
| AUTH-019 | EDGE | P1 | `GET /v1/health` có `@SkipRateLimit` → không bị 429 dù spam |
| PLAT-001 | GREEN | P0 | Admin tạo user mới (role marketer) → 201, user đăng nhập được |
| PLAT-002 | GREEN | P0 | Admin tạo API key (role connector) → 201, rawKey hiện 1 lần |
| PLAT-003 | RED | P0 | Tạo user trùng username → 409/400 báo lỗi rõ |
| PLAT-004 | GREEN | P0 | Admin disable user → user đó login bị từ chối / request bị 401-403 |
| PLAT-005 | GREEN | P0 | Admin revoke API key → key đó gọi API → 401 |
| PLAT-006 | SECURITY | P0 | Non-admin (marketer) mở /platform hoặc gọi POST /v1/auth/users → 403 |
| PLAT-007 | DATA | P1 | rawKey API key chỉ trả về 1 lần (list sau đó không lộ raw) |
| PLAT-008 | UI_CONSISTENCY | P1 | Màn Login + Platform dùng chung App shell tokens; badge status active=green/disabled=orange nhất quán với các workspace khác |
| PLAT-009 | EDGE | P1 | Tạo user role `connector` rồi connector đó đăng nhập UI → chỉ ingestion, UI không có workspace phù hợp |

### Case chi tiết trọng yếu — Module 1

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **AUTH-001** | GREEN·P0 | Dev user admin/admin12345 đã seed; đang ở `/login` | 1. Nhập "admin" ô Tên đăng nhập<br>2. Nhập "admin12345" ô Mật khẩu<br>3. Click "Đăng nhập" | admin / admin12345 | 1. `POST /v1/auth/login` → 200, body `{data:{token,role:"admin",name}}`<br>2. Token + role + name lưu localStorage (`occ_token/occ_role/occ_name`)<br>3. Điều hướng `/control-tower`, sidebar hiện đủ 8 workspace<br>4. Không thông báo lỗi |
| **AUTH-002** | RED·P0 | User admin tồn tại | 1. Nhập "admin"<br>2. Nhập "saiquaroi"<br>3. Click Đăng nhập | admin / saiquaroi | 1. 401, error.code `UNAUTHENTICATED`<br>2. UI hiện "Sai tên đăng nhập hoặc mật khẩu."<br>3. KHÔNG vào dashboard; không lưu token |
| **AUTH-003** | RED·P0 | — | 1. Nhập "khongtontai999"<br>2. Nhập "batky12345"<br>3. Đăng nhập | khongtontai999 / batky12345 | 1. 401 với CÙNG message như sai mật khẩu (không tiết lộ user tồn tại hay không)<br>2. Thời gian phản hồi tương đương case sai mật khẩu (dummy-hash chống timing enumeration) |
| **AUTH-006** | SECURITY·P0 | Có 1 JWT hợp lệ | 1. Sửa header JWT thành `alg:"none"` bỏ chữ ký<br>2. Gọi `GET /v1/customers/lookup` với token đó | token alg=none | 1. 401 UNAUTHENTICATED — server từ chối alg-confusion, không decode payload tin tưởng |
| **AUTH-009** | SECURITY·P0 | API key role connector vừa tạo, sau đó revoke qua `POST /v1/auth/api-keys/{id}/revoke` | 1. Gọi `POST /v1/ingest` với Bearer = rawKey đã revoke | rawKey revoked | 1. 401 UNAUTHENTICATED; không xử lý ingest |
| **AUTH-010** | SECURITY·P0 | Đăng nhập role `csr` (token csr) | 1. Gọi `GET /v1/auth/users` với token csr | token csr | 1. 403 FORBIDDEN, error envelope đầy đủ; không trả danh sách user |
| **AUTH-012** | SECURITY·P0 | User U có role marketer, đang có token hợp lệ | 1. Admin gọi `POST /v1/auth/users/{U}/status` set disabled<br>2. Dùng token cũ của U gọi `GET /v1/journeys` | token U (cũ) | 1. Request sau khi disable → 401/403 ngay (role/status đọc lại từ DB mỗi request), không chờ token hết hạn |
| **AUTH-017** | SECURITY·P0 | Bật `RATE_LIMIT_PUBLIC_BURST=5`, refill thấp | 1. Gửi 6 `POST /v1/auth/login` sai mật khẩu liên tiếp từ cùng IP | 6 login burst | 1. Request thứ 6 → 429, error.code `RATE_LIMIT_*`, header `Retry-After`, retryable=true<br>2. Không khóa vĩnh viễn — sau Retry-After cho lại |
| **PLAT-002** | GREEN·P0 | Đăng nhập admin, ở `/platform` | 1. Nhập "POS Givral key" ô Tên API key<br>2. Chọn vai trò "connector"<br>3. Click "Tạo API key" | name="POS Givral key", role=connector | 1. `POST /v1/auth/api-keys` → 201<br>2. Box "API key mới — sao chép ngay (chỉ hiện 1 lần)" hiện rawKey (testid `new-raw-key`)<br>3. Bảng API key thêm dòng status=active (green)<br>4. Reload trang → rawKey KHÔNG còn hiện |
| **PLAT-006** | SECURITY·P0 | Đăng nhập role marketer | 1. Gọi `POST /v1/auth/users` body hợp lệ với token marketer | token marketer | 1. 403 FORBIDDEN; không tạo user. (UI: workspace Platform không thao tác được/không hiển thị nút admin) |

---

## S9.2. Module 11 — Master Data (Data Ops)

**Bề mặt:** `GET /v1/brands`, `GET/POST /v1/stores`, `GET/POST /v1/products`, `POST /v1/categories`, `POST /v1/sku-mappings`; workspace **Data Ops** (`/data-ops`) — panel Thương hiệu (read), Cửa hàng (CRUD form), Sản phẩm (CRUD form). Create chỉ `data_steward`/admin; read nhiều role.

### Ma trận truy vết — Module 11

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| MAST-001 | GREEN | P0 | Data Ops hiển thị 5 brand seed từ `GET /v1/brands` |
| MAST-002 | GREEN | P0 | data_steward tạo store mới qua form → list cập nhật (không seed API) |
| MAST-003 | GREEN | P0 | data_steward tạo product mới qua form → list cập nhật |
| MAST-004 | GREEN | P1 | Tạo category (`POST /v1/categories`) → 201 |
| MAST-005 | GREEN | P1 | Tạo sku-mapping (brand+pos_sku→product_master) → 201 |
| MAST-006 | GREEN | P1 | `GET /v1/stores?brand_id=` lọc đúng store theo brand |
| MAST-007 | RED | P0 | Tạo store thiếu store_id/name → 400 SCHEMA_MISSING_REQUIRED_FIELD field_path đúng |
| MAST-008 | RED | P1 | Tạo store với brand_id không tồn tại → lỗi FK/validation rõ, không tạo |
| MAST-009 | RED | P1 | Tạo store trùng store_id → 409/400 báo trùng |
| MAST-010 | SECURITY | P0 | role marketer/csr gọi `POST /v1/stores` → 403 (chỉ data_steward) |
| MAST-011 | SECURITY | P0 | role connector gọi `GET /v1/brands` → 403 (không trong danh sách read) |
| MAST-012 | DATA | P1 | Tên store/product tiếng Việt có dấu ("Givral Đồng Khởi") lưu & hiển thị đúng UTF-8 |
| MAST-013 | DATA | P1 | Tên có emoji / ký tự đặc biệt → lưu đúng hoặc reject có kiểm soát |
| MAST-014 | BOUNDARY | P2 | store_id/name rỗng "" vs 1 ký tự (min 1) → "" fail, 1 ký tự pass |
| MAST-015 | EDGE | P1 | Form tạo store khi chưa có brand nào → dropdown brand rỗng, nút disable/hướng dẫn |
| MAST-016 | EDGE | P1 | Tạo product không có unit/category (optional) → 201, hiển thị "—" |
| MAST-017 | PERFORMANCE | P2 | `GET /v1/products` với ≥1000 sản phẩm trả < 2s; UI không treo |
| MAST-018 | UI_CONSISTENCY | P1 | 3 panel Data Ops: empty state ("Chưa có…"), loading, error nhất quán UX State Contract |
| MAST-019 | UI_CONSISTENCY | P1 | Placeholder ô trống dùng "—" nhất quán (store city, product unit) |
| MAST-020 | RED | P1 | Double-click "Thêm cửa hàng" → không tạo 2 store trùng (fieldset disable khi pending) |

### Case chi tiết trọng yếu — Module 11

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **MAST-002** | GREEN·P0 | Đăng nhập data_steward (hoặc admin), ở `/data-ops`; brand "givral" tồn tại | 1. Panel Cửa hàng: nhập Mã "ST-GV-01"<br>2. Chọn Thương hiệu "Givral"<br>3. Nhập Tên "Givral Đồng Khởi"<br>4. Nhập Thành phố "TP.HCM"<br>5. Click "Thêm cửa hàng" | store_id=ST-GV-01, brand=givral, name=Givral Đồng Khởi, city=TP.HCM | 1. `POST /v1/stores` → 201 `{data:{store_id}}`<br>2. Danh sách store thêm dòng `ST-GV-01 · Givral Đồng Khởi | TP.HCM`<br>3. Không có lỗi; form sẵn sàng nhập tiếp |
| **MAST-007** | RED·P0 | Đăng nhập data_steward | 1. Gọi `POST /v1/stores` body `{brand_id:"givral"}` (thiếu store_id, name) | thiếu store_id/name | 1. 400, error.code `SCHEMA_MISSING_REQUIRED_FIELD`<br>2. `field_path` chỉ đúng field thiếu (store_id)<br>3. envelope có why/fix/correlation_id |
| **MAST-010** | SECURITY·P0 | Token role marketer | 1. `POST /v1/stores` body hợp lệ với token marketer | token marketer | 1. 403 FORBIDDEN; store không được tạo |
| **MAST-012** | DATA·P1 | data_steward | 1. Tạo store name "Givral Đồng Khởi", city "TP. Hồ Chí Minh"<br>2. Reload list | tên có dấu | 1. Lưu & hiển thị đúng dấu tiếng Việt, không mojibake |
| **MAST-020** | RED·P1 | Ở `/data-ops` | 1. Điền form store hợp lệ<br>2. Double-click nhanh "Thêm cửa hàng" | — | 1. Chỉ 1 store được tạo; fieldset/nút disable khi pending chặn submit lần 2 |

---

## S9.3. Module 2 — Ingestion (POS / Connector)

**Bề mặt:** `POST /v1/ingest` (discriminated union `type`: `order_completed` | `identify`), 202 Accepted, role `connector`. Idempotency key `{brand}:{store}:{pos_transaction_id}`. Không có UI riêng (service-to-service); kiểm qua API + xác minh hệ quả ở Customer 360.

### Ma trận truy vết — Module 2

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| ING-001 | GREEN | P0 | Ingest order_completed hợp lệ (có identifiers + total) → 202, sinh occId + canonical_transaction |
| ING-002 | GREEN | P0 | Ingest identify hợp lệ (traits) → 202, profile cập nhật |
| ING-003 | GREEN | P0 | Ingest cùng `{brand}:{store}:{pos_transaction_id}` 2 lần → idempotent, KHÔNG tạo đơn trùng (idempotent=true) |
| ING-004 | GREEN | P0 | 2 đơn 2 brand cùng phone → resolve về cùng occId (hợp nhất xuyên thương hiệu) |
| ING-005 | RED | P0 | type không thuộc {order_completed,identify} → 400 UNKNOWN_EVENT_TYPE |
| ING-006 | RED | P0 | order_completed thiếu properties.pos_transaction_id → 400 SCHEMA_MISSING_REQUIRED_FIELD |
| ING-007 | RED | P0 | order_completed thiếu properties.total → 400 |
| ING-008 | RED | P0 | identifiers có nhưng TẤT CẢ sai chuẩn hóa → 400 INVALID_IDENTIFIER |
| ING-009 | RED | P1 | identify thiếu identifiers (min 1) → 400 |
| ING-010 | SECURITY | P0 | Gọi /v1/ingest bằng token role marketer (không phải connector) → 403 |
| ING-011 | SECURITY | P0 | Gọi /v1/ingest không Authorization → 401 |
| ING-012 | DATA | P0 | Phone "0901234567" và "+84901234567" và "84901234567" → cùng value_normalized (E.164 VN) → cùng occId |
| ING-013 | DATA | P1 | Email "Alice@Test.COM " (hoa + space) → normalize lowercase/trim → cùng occId với "alice@test.com" |
| ING-014 | DATA | P1 | identify traits full_name tiếng Việt có dấu, emoji → lưu đúng UTF-8 |
| ING-015 | DATA | P1 | Survivorship: identify lần 2 với full_name=null không xóa tên đã có (COALESCE) |
| ING-016 | BOUNDARY | P1 | properties.total = 0 (đơn 0đ/free) → chấp nhận (EDGE hợp lệ) |
| ING-017 | BOUNDARY | P1 | properties.total âm → reject (400) hoặc kiểm soát rõ |
| ING-018 | BOUNDARY | P2 | total rất lớn (vượt safe integer) → xử lý không tràn/sai số |
| ING-019 | EDGE | P1 | order_completed KHÔNG có identifiers → vẫn tạo canonical_transaction (occId ẩn danh) |
| ING-020 | EDGE | P1 | occ_timestamp sai format ISO (thiếu offset) → 400 SCHEMA_TYPE_MISMATCH |
| ING-021 | DATA | P1 | Ingest LUÔN nhận dù khách chưa cấp consent (consent chỉ gate activation) |
| ING-022 | PERFORMANCE | P1 | 20 ingest đồng thời khác pos_txn → đều 202, không lỗi, < 3s |
| ING-023 | SECURITY | P0 | Race: 2 ingest đồng thời CÙNG idempotency key → đúng 1 canonical_transaction (advisory lock / ON CONFLICT) |

### Case chi tiết trọng yếu — Module 2

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **ING-001** | GREEN·P0 | API key role connector; brand "givral", store "ST-GV-01" tồn tại | 1. `POST /v1/ingest` body order_completed (xem dữ liệu) | `{type:"order_completed",brand_id:"givral",store_id:"ST-GV-01",source:"pos",occ_timestamp:"2026-06-18T10:30:00+07:00",identifiers:[{type:"phone",value:"0901234567"}],properties:{pos_transaction_id:"TXN-1001",total:150000,items:[...]}}` | 1. 202, body `{data:{messageId,occId,idempotent:false}}`<br>2. Lookup phone 0901234567 ở Customer 360 → ra occId này, txn-count ≥1 |
| **ING-003** | GREEN·P0 | Đã ingest TXN-1001 ở ING-001 | 1. Gửi lại body y hệt ING-001 | cùng pos_transaction_id | 1. 202, `idempotent:true`<br>2. Customer 360 txn-count KHÔNG tăng (vẫn 1)<br>3. Không tạo canonical_transaction thứ 2 |
| **ING-004** | GREEN·P0 | API key connector; brand "givral" và "ktt" tồn tại | 1. Ingest đơn brand givral, phone 0905555666, TXN-A<br>2. Ingest đơn brand ktt, phone 0905555666, TXN-B | cùng phone 0905555666, khác brand/pos_txn | 1. Cả 2 → 202<br>2. occId trả về ở 2 response GIỐNG NHAU<br>3. Customer 360 lookup phone → 1 hồ sơ, txn-count=2, identifiers gộp |
| **ING-008** | RED·P0 | API key connector | 1. Ingest order_completed với identifiers=[{type:"phone",value:"abc"}] (sai), không identifier nào hợp lệ | phone="abc" | 1. 400, error.code `INVALID_IDENTIFIER`, why/fix rõ; không tạo occId rác |
| **ING-012** | DATA·P0 | API key connector | 1. Ingest TXN-N1 phone "0901234567"<br>2. Ingest TXN-N2 phone "+84901234567"<br>3. Ingest TXN-N3 phone "84901234567" | 3 format cùng số | 1. Cả 3 → 202<br>2. occId của 3 response GIỐNG NHAU (chuẩn hóa E.164 trước resolve) |
| **ING-021** | DATA·P0 | Khách occX CHƯA có consent nào | 1. Ingest order_completed gắn occX | — | 1. 202 thành công (ingestion KHÔNG gate consent)<br>2. Giao dịch được ghi nhận bình thường |
| **ING-023** | SECURITY·P0 | API key connector | 1. Bắn đồng thời 5 request cùng `{givral}:{ST-GV-01}:{TXN-RACE}` | cùng key, song song | 1. Đúng 1 canonical_transaction tồn tại; các response còn lại idempotent=true; không nhân bản |

---

## S9.4. Module 3 — Identity / Customer 360

**Bề mặt:** `GET /v1/customers/lookup?type=&value=&brand_id?=` (role csr/analyst/marketer/data_steward); workspace **Customers** (`/customers`) — dropdown loại định danh (phone/email/loyalty_card/pos_member_id), ô giá trị, nút Tra cứu, thẻ Customer 360 + section cross-sell AI. Resolve dựa materialized resolved_identifier→occ_id.

### Ma trận truy vết — Module 3

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| ID-001 | GREEN | P0 | Lookup theo phone đã ingest → hiển thị thẻ Customer 360 (occId, txn-count, identifiers) |
| ID-002 | GREEN | P0 | Lookup theo email đã ingest → ra đúng hồ sơ hợp nhất |
| ID-003 | GREEN | P1 | Lookup theo loyalty_card / pos_member_id → ra hồ sơ |
| ID-004 | GREEN | P0 | Hồ sơ hợp nhất xuyên brand hiển thị đủ identifiers từ nhiều brand |
| ID-005 | RED | P0 | Lookup identifier chưa gắn occId → 404 CUSTOMER_NOT_FOUND + UI "Không tìm thấy khách hàng" |
| ID-006 | RED | P0 | Lookup thiếu type hoặc value → 400 SCHEMA_MISSING_REQUIRED_FIELD |
| ID-007 | RED | P1 | type không thuộc enum cho phép → 400 |
| ID-008 | SECURITY | P0 | role connector/compliance gọi lookup → 403 (không trong danh sách) |
| ID-009 | SECURITY | P0 | Lookup không Authorization → 401 |
| ID-010 | DATA | P0 | Lookup phone "0901234567" tìm được dù ingest dạng "+84901234567" (resolve qua normalized) |
| ID-011 | DATA | P1 | Lookup email không phân biệt hoa thường (Alice@test.com = alice@test.com) |
| ID-012 | DATA | P1 | Giá trị lookup có khoảng trắng đầu/cuối → trim trước khi resolve |
| ID-013 | EDGE | P1 | Hồ sơ chưa có full_name → hiển thị "(chưa có tên)" |
| ID-014 | EDGE | P1 | Hồ sơ có cross-sell recommendations → hiện section AI; không có → ẩn section (không lỗi) |
| ID-015 | SECURITY | P1 | IDOR/injection: value chứa payload SQL (`' OR 1=1--`) → không lộ dữ liệu, trả 404/400 an toàn |
| ID-016 | UI_CONSISTENCY | P1 | UX State Contract: idle ("Nhập định danh…"), loading ("Đang tải…"), notfound, error, success nhất quán |
| ID-017 | UI_CONSISTENCY | P1 | Guard chống stale-response: tra cứu liên tiếp 2 giá trị → chỉ hiển thị kết quả request mới nhất |
| ID-018 | PERFORMANCE | P1 | Lookup phản hồi < 2s (materialized resolved_identifier, không traverse graph runtime) |

### Case chi tiết trọng yếu — Module 3

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **ID-001** | GREEN·P0 | Đăng nhập csr; đã ingest đơn phone 0901234567 (ING-001); ở `/customers` | 1. Chọn dropdown "Số điện thoại"<br>2. Nhập "0901234567" ô Giá trị<br>3. Click "Tra cứu" | type=phone, value=0901234567 | 1. `GET /v1/customers/lookup?type=phone&value=0901234567` → 200<br>2. Thẻ hiện OCC ID (mono), txn-count (testid `txn-count`) ≥1<br>3. Section identifiers liệt kê `phone: <normalized>`<br>4. Không lỗi |
| **ID-004** | GREEN·P0 | Đã chạy ING-004 (2 brand cùng phone) | 1. Lookup phone 0905555666 | type=phone | 1. 1 hồ sơ duy nhất, txn-count=2<br>2. identifiers gộp từ cả 2 brand<br>3. occId khớp occId 2 response ingest |
| **ID-005** | RED·P0 | Đăng nhập csr | 1. Chọn "Email"<br>2. Nhập "khongtontai@nowhere.com"<br>3. Tra cứu | email chưa ingest | 1. 404 `CUSTOMER_NOT_FOUND`<br>2. UI hiện tiêu đề "Không tìm thấy khách hàng" + giải thích "chưa gắn với OCC ID nào"<br>3. Không hiện thẻ rỗng/lỗi đỏ |
| **ID-008** | SECURITY·P0 | Token role connector | 1. `GET /v1/customers/lookup?type=phone&value=0901234567` token connector | token connector | 1. 403 FORBIDDEN |
| **ID-015** | SECURITY·P1 | Đăng nhập csr | 1. Nhập value `' OR 1=1--`<br>2. Tra cứu | SQL injection payload | 1. Không lộ dữ liệu khách khác; trả 404 hoặc 400 an toàn; không 500; không thực thi SQL |
| **ID-017** | UI_CONSISTENCY·P1 | Ở `/customers` | 1. Tra cứu phone A (chậm)<br>2. Ngay lập tức đổi value và tra cứu phone B | A rồi B liên tiếp | 1. Kết quả hiển thị là của B (request mới nhất), không bị A ghi đè dù A về sau (guard reqId) |

---

## S9.5. Module 4 — Loyalty (double-entry)

**Bề mặt:** `POST /v1/loyalty/{earn,reserve,capture,release}`, `GET /v1/loyalty/balance` (csr; balance đọc csr/analyst). Idempotency key + fingerprint; reservation state machine held→captured|released; advisory lock; trigger DB sum(delta)=0; cấm âm. Workspace **Loyalty** (`/loyalty`).

### Ma trận truy vết — Module 4

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| LOY-001 | GREEN | P0 | Earn điểm hợp lệ → balance tăng đúng, journalId trả về |
| LOY-002 | GREEN | P0 | Reserve điểm ≤ available → status reserved, available giảm, balance giữ nguyên |
| LOY-003 | GREEN | P0 | Capture reservation đang held → status captured, balance giảm đúng |
| LOY-004 | GREEN | P0 | Release reservation đang held → status released, available phục hồi |
| LOY-005 | GREEN | P0 | Balance = projection: sau earn 100, reserve 30, capture 30 → available=70, balance=70 |
| LOY-006 | RED | P0 | Earn cùng idempotencyKey, points KHÁC → 409 IDEMPOTENCY_CONFLICT |
| LOY-007 | GREEN | P0 | Earn cùng idempotencyKey, points GIỐNG (retry) → idempotent, không cộng kép |
| LOY-008 | RED | P0 | Reserve > available → 409 INSUFFICIENT_BALANCE |
| LOY-009 | RED | P0 | Capture reservation đã captured → 409 RESERVATION_INVALID_STATE |
| LOY-010 | RED | P0 | Release reservation đã captured → 409 RESERVATION_INVALID_STATE |
| LOY-011 | RED | P0 | Capture/release reservationId không tồn tại → 404 RESERVATION_NOT_FOUND |
| LOY-012 | RED | P0 | Earn points ≤ 0 → 400 INVALID_AMOUNT |
| LOY-013 | BOUNDARY | P0 | Earn points = 1 (min hợp lệ) → OK; = 0 → reject |
| LOY-014 | BOUNDARY | P1 | Reserve đúng bằng available (biên) → OK; available+1 → INSUFFICIENT_BALANCE |
| LOY-015 | BOUNDARY | P1 | Points vượt safe integer → 400 INVALID_AMOUNT, không tràn |
| LOY-016 | SECURITY | P0 | role analyst gọi POST /loyalty/earn → 403 (chỉ csr); GET /balance analyst → OK |
| LOY-017 | SECURITY | P0 | Không Authorization → 401 |
| LOY-018 | SECURITY | P0 | Race: 2 reserve đồng thời tổng > available → chỉ 1 thành công, không âm (advisory lock) |
| LOY-019 | DATA | P0 | Không bao giờ balance/available âm dù chuỗi thao tác bất kỳ |
| LOY-020 | EDGE | P1 | Balance occId chưa từng earn → 0/0, không lỗi |
| LOY-021 | EDGE | P1 | Reserve rồi release rồi reserve lại cùng số điểm → hợp lệ |
| LOY-022 | UI_CONSISTENCY | P1 | UI Loyalty: thẻ available/reserved (testid bal-available/bal-reserved), reservation list state held/đã chốt/đã hủy nhất quán |
| LOY-023 | PERFORMANCE | P1 | 10 earn đồng thời khác key → đúng tổng điểm, không mất cập nhật |

### Case chi tiết trọng yếu — Module 4

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **LOY-005** | GREEN·P0 | occZ balance=0; đăng nhập csr | 1. earn 100 (key k1)<br>2. reserve 30 (key k2)<br>3. capture reservation (key k3)<br>4. GET balance | occZ; 100/30 | 1. Sau earn: balance=100,available=100<br>2. Sau reserve: balance=100,reserved=30,available=70<br>3. Sau capture: balance=70,reserved=0,available=70<br>4. balance là projection từ ledger (sum delta=0 mỗi bút toán) |
| **LOY-006** | RED·P0 | occZ tồn tại | 1. earn 50 key="K-DUP"<br>2. earn 80 key="K-DUP" | cùng key khác points | 1. Bước 2 → 409 `IDEMPOTENCY_CONFLICT` (fingerprint khác)<br>2. balance chỉ +50 |
| **LOY-008** | RED·P0 | occZ available=70 | 1. reserve 100 | reserve 100 > 70 | 1. 409 `INSUFFICIENT_BALANCE`; available giữ 70 |
| **LOY-009** | RED·P0 | reservation R đang captured | 1. capture R lần nữa (key mới) | R đã captured | 1. 409 `RESERVATION_INVALID_STATE`; không trừ kép |
| **LOY-018** | SECURITY·P0 | occZ available=50 | 1. Bắn đồng thời reserve 40 và reserve 40 | 2×40 song song | 1. Chỉ 1 thành công (status reserved); cái còn lại 409 INSUFFICIENT_BALANCE<br>2. available cuối = 10, KHÔNG âm |
| **LOY-019** | DATA·P0 | occZ bất kỳ | 1. Thử chuỗi earn/reserve/capture/release ngẫu nhiên | nhiều thao tác | 1. Mọi thời điểm balance≥0 và available≥0; trigger DB chặn vi phạm |
| **LOY-003 (UI)** | GREEN·P0 | Đăng nhập csr, `/loyalty`; occZ có điểm | 1. Nhập occZ ô OCC ID, "Xem số dư"<br>2. Nhập 30 ô "Số điểm giữ", "Giữ điểm"<br>3. Ở reservation list bấm "Chốt" | occZ; reserve 30 | 1. Thẻ available/reserved cập nhật đúng<br>2. Reservation hiện trong "Đơn giữ trong phiên" testid reservation-{id}<br>3. Sau "Chốt" → status "đã chốt", available giảm |

---

## S9.6. Module 5 — Consent (Governance)

**Bề mặt:** `POST /v1/consent` (compliance/csr), `GET /v1/consent?occId=` + `GET /v1/consent/check?occId=&purpose=` (compliance/csr/marketer/analyst). 5 purpose: marketing_email/sms/zalo, personalization, data_sharing. Append-only (trigger chặn UPDATE/DELETE), deny-by-default, latest-wins. Workspace **Governance** (`/governance`).

### Ma trận truy vết — Module 5

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| CON-001 | GREEN | P0 | Ghi consent granted cho marketing_email → 201, check trả allowed=true |
| CON-002 | GREEN | P0 | Rút consent (withdrawn) → check trả allowed=false |
| CON-003 | GREEN | P0 | Deny-by-default: occ chưa ghi consent nào → check allowed=false |
| CON-004 | GREEN | P0 | Latest-wins: granted → withdrawn → granted, check phản ánh bản mới nhất (allowed=true) |
| CON-005 | GREEN | P1 | GET /consent liệt kê đủ lịch sử/trạng thái 5 purpose |
| CON-006 | SECURITY | P0 | Append-only: không có endpoint sửa/xóa consent; DB trigger chặn UPDATE/DELETE |
| CON-007 | RED | P0 | POST /consent purpose ngoài enum → 400 |
| CON-008 | RED | P0 | POST /consent status ngoài {granted,withdrawn} → 400 |
| CON-009 | RED | P1 | POST /consent thiếu occId/purpose/status/source → 400 SCHEMA_MISSING_REQUIRED_FIELD |
| CON-010 | SECURITY | P0 | role connector/executive gọi POST /consent → 403 |
| CON-011 | SECURITY | P0 | Không Authorization → 401 |
| CON-012 | DATA | P0 | Consent chỉ gate ACTIVATION; ingestion & loyalty cho occ chưa consent vẫn chạy |
| CON-013 | EDGE | P1 | Ghi consent cho từng purpose độc lập: granted email KHÔNG kéo theo sms |
| CON-014 | EDGE | P1 | Race: granted + withdrawn cùng purpose đồng thời → latest-wins xác định, advisory lock per (occ,purpose) |
| CON-015 | DATA | P1 | evidence/channel tiếng Việt + dài (max 2000) lưu đúng |
| CON-016 | BOUNDARY | P2 | evidence 2000 ký tự (max) OK; 2001 → 400 |
| CON-017 | UI_CONSISTENCY | P1 | Governance: 5 purpose list, badge granted=green/withdrawn=orange/denied=subtle nhất quán; nút Cấp disable khi đã granted, Thu hồi disable khi chưa granted |
| CON-018 | PERFORMANCE | P2 | GET /consent < 2s; check < 1s |

### Case chi tiết trọng yếu — Module 5

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **CON-001** | GREEN·P0 | Đăng nhập csr/compliance, `/governance`; occY hợp lệ | 1. Nhập occY, "Xem consent"<br>2. Ở dòng "Email marketing" bấm "Cấp" | occY; purpose=marketing_email | 1. `POST /v1/consent {status:"granted",source:"csr"}` → 201<br>2. Badge marketing_email → "GRANTED" (green)<br>3. `GET /consent/check?purpose=marketing_email` → allowed=true |
| **CON-003** | GREEN·P0 | occW chưa từng ghi consent | 1. `GET /v1/consent/check?occId=occW&purpose=marketing_sms` | occW | 1. 200, `{allowed:false}` (deny-by-default) |
| **CON-004** | GREEN·P0 | occY | 1. POST granted email<br>2. POST withdrawn email<br>3. POST granted email<br>4. check | 3 lần ghi | 1. check trả allowed=true (latest-wins)<br>2. GET /consent list có đủ 3 bản ghi (append-only, không mất lịch sử) |
| **CON-006** | SECURITY·P0 | Có consent đã ghi | 1. Thử mọi endpoint sửa/xóa consent (không tồn tại); 2. (DB) thử UPDATE/DELETE trực tiếp | — | 1. Không có API mutate; DB trigger raise lỗi chặn UPDATE/DELETE → audit bất biến |
| **CON-012** | DATA·P0 | occW chưa consent | 1. Ingest đơn cho occW (connector)<br>2. earn điểm cho occW (csr) | — | 1. Cả 2 thành công — consent KHÔNG chặn ingestion/loyalty<br>2. Chỉ activation mới gate (xem ACT-002) |
| **CON-017** | UI_CONSISTENCY·P1 | `/governance`, occY granted email | 1. Quan sát dòng marketing_email | — | 1. Nút "Cấp" disable (đã granted), "Thu hồi" enable; badge green; các purpose chưa cấp badge "DENIED" subtle, nút Thu hồi disable |

---

## S9.7. Module 6 — Activation (Audiences) — CHOKEPOINT CONSENT DUY NHẤT

**Bề mặt:** `POST /v1/activation` (marketer; body audienceName/purpose/channel/destination/occIds≤100k), `GET /v1/activation/{runId}` (marketer). Lọc occId qua `consent.isAllowed(purpose)`: chưa granted → suppressed_no_consent. Ghi activation_run + activation_member. Workspace **Audiences** (`/audiences`).

### Ma trận truy vết — Module 6

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| ACT-001 | GREEN | P0 | Activation với occ ĐÃ granted purpose → allowed (gửi) |
| ACT-002 | GREEN | P0 | Activation với occ CHƯA granted → suppressed_no_consent (deny-by-default) |
| ACT-003 | GREEN | P0 | Hỗn hợp: 1 granted + 1 chưa → total=2, allowed=1, suppressed=1 |
| ACT-004 | GREEN | P0 | total = allowed + suppressed (bất biến đếm) |
| ACT-005 | GREEN | P1 | GET /activation/{runId} trả đúng số liệu run đã chạy |
| ACT-006 | RED | P0 | occ đã withdrawn purpose → suppressed (không gửi) |
| ACT-007 | RED | P1 | POST /activation thiếu audienceName/purpose/occIds → 400 |
| ACT-008 | RED | P1 | purpose ngoài enum → 400 |
| ACT-009 | SECURITY | P0 | role csr/analyst gọi POST /activation → 403 (chỉ marketer) |
| ACT-010 | SECURITY | P0 | Không Authorization → 401 |
| ACT-011 | SECURITY | P0 | GET /activation/{runId} của run không tồn tại → 404 |
| ACT-012 | BOUNDARY | P1 | occIds rỗng [] → 400/UI nút disable; 1 occId → OK |
| ACT-013 | BOUNDARY | P2 | occIds = 100.000 (max) → OK; 100.001 → reject |
| ACT-014 | EDGE | P1 | occId không tồn tại trong danh sách → suppressed/bỏ qua có kiểm soát, không crash |
| ACT-015 | DATA | P0 | Consent withdrawn giữa 2 lần activation → lần sau suppressed (gate động) |
| ACT-016 | UI_CONSISTENCY | P1 | Audiences: thẻ kết quả total/allowed/suppressed (testid act-total/allowed/suppressed) màu success/warning nhất quán |
| ACT-017 | PERFORMANCE | P1 | Activation 1000 occId < 5s, không timeout UI |

### Case chi tiết trọng yếu — Module 6

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **ACT-002** | GREEN·P0 | Đăng nhập marketer; occW CHƯA granted marketing_email; `/audiences` | 1. Nhập Tên audience "Promo T6"<br>2. Chọn Mục đích "marketing_email"<br>3. Kênh "email", Destination "rudderstack"<br>4. Dán occW vào textarea OCC ID<br>5. "Kích hoạt" | occW; purpose=marketing_email | 1. `POST /v1/activation` → 201<br>2. Thẻ kết quả: Tổng=1 (act-total), Được gửi=0 (act-allowed), Bị chặn=1 (act-suppressed, warning)<br>3. decision = suppressed_no_consent |
| **ACT-003** | GREEN·P0 | occA granted marketing_email; occB chưa | 1. Activation purpose=marketing_email, occIds=[occA,occB] | occA,occB | 1. total=2, allowed=1 (occA), suppressed=1 (occB)<br>2. GET /activation/{runId} khớp số liệu |
| **ACT-009** | SECURITY·P0 | Token role csr | 1. `POST /v1/activation` body hợp lệ token csr | token csr | 1. 403 FORBIDDEN; không tạo run |
| **ACT-015** | DATA·P0 | occA granted email; đã activation lần 1 (allowed) | 1. POST consent withdrawn email cho occA<br>2. Activation lại occA purpose=email | occA | 1. Lần 2: occA → suppressed (gate đọc consent hiện tại, latest-wins)<br>2. allowed=0, suppressed=1 |

---

## S9.8. Module 7 — Segment

**Bề mặt:** `POST /v1/segments/preview` (marketer/analyst; body brandId?/minSpend?/minTransactions?) → {occIds, count}. Feed cho Activation/Journey. UI ở **Audiences** (Segment Builder).

### Ma trận truy vết — Module 7

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| SEG-001 | GREEN | P0 | Preview minSpend → trả đúng occIds khách chi tiêu ≥ ngưỡng |
| SEG-002 | GREEN | P0 | Preview minTransactions → đúng khách có số giao dịch ≥ ngưỡng |
| SEG-003 | GREEN | P1 | Preview brandId → chỉ khách của brand đó |
| SEG-004 | GREEN | P1 | Kết hợp brandId + minSpend + minTransactions → giao điều kiện |
| SEG-005 | EDGE | P1 | Không truyền tiêu chí nào → trả tất cả khách (hoặc rule mặc định rõ) |
| SEG-006 | EDGE | P1 | Tiêu chí loại trừ hết (minSpend cực lớn) → count=0, UI empty hợp lý |
| SEG-007 | RED | P1 | minSpend âm → 400 (non-negative); minTransactions ≤0 → 400 (positive) |
| SEG-008 | BOUNDARY | P1 | Khách chi tiêu đúng = ngưỡng → có được tính (≥)? Xác nhận semantics biên |
| SEG-009 | SECURITY | P0 | role csr/connector gọi preview → 403 (chỉ marketer/analyst) |
| SEG-010 | SECURITY | P0 | Không Authorization → 401 |
| SEG-011 | DATA | P0 | count = số phần tử occIds (bất biến); occIds feed nguyên vẹn sang activation |
| SEG-012 | UI_CONSISTENCY | P1 | Segment Builder: badge "khớp **N** khách" (testid segment-count) nhất quán |
| SEG-013 | PERFORMANCE | P1 | Preview trên tập lớn < 3s |

### Case chi tiết trọng yếu — Module 7

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **SEG-001** | GREEN·P0 | Đăng nhập marketer; có khách chi tiêu 150k & 50k | 1. `/audiences` Segment Builder: nhập Chi tiêu tối thiểu "100000"<br>2. "Xem trước segment" | minSpend=100000 | 1. `POST /v1/segments/preview` → 200<br>2. Badge "khớp **N** khách" (N=số khách ≥100k)<br>3. Khách 50k KHÔNG trong tập |
| **SEG-006** | EDGE·P1 | marketer | 1. minSpend="999999999"<br>2. Xem trước | cực lớn | 1. count=0; UI hiển thị "khớp 0 khách" rõ ràng, không lỗi |
| **SEG-009** | SECURITY·P0 | Token csr | 1. `POST /v1/segments/preview` token csr | token csr | 1. 403 FORBIDDEN |
| **SEG-011** | DATA·P0 | Preview ra N occId | 1. Lấy occIds preview → đưa thẳng vào Activation | — | 1. Số occId activation nhận = count preview; không rớt/nhân bản |

---

## S9.9. Module 8 — Journey (Orchestration)

**Bề mặt:** `GET/POST /v1/journeys`, `POST /v1/journeys/{id}/run` (marketer). action discriminated union: `loyalty_bonus{points}` | `activation{purpose,channel,destination}`. loyalty_bonus dùng idempotencyKey `journey:{runId}:{occId}`; activation vẫn gate consent. Workspace **Journeys** (`/journeys`).

### Ma trận truy vết — Module 8

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| JNY-001 | GREEN | P0 | Tạo journey loyalty_bonus → 201 status draft |
| JNY-002 | GREEN | P0 | Tạo journey activation → 201 |
| JNY-003 | GREEN | P0 | Run journey loyalty_bonus → cộng điểm cho đúng tập segment |
| JNY-004 | GREEN | P0 | Run journey activation → gate consent (allowed/suppressed) như Activation |
| JNY-005 | GREEN | P0 | Run journey loyalty_bonus 2 lần → KHÔNG cộng điểm trùng (idempotency journey:{runId}:{occId}) |
| JNY-006 | GREEN | P1 | GET /journeys liệt kê journey + action mô tả đúng |
| JNY-007 | RED | P1 | Tạo journey thiếu name → 400 |
| JNY-008 | RED | P1 | action type ngoài {loyalty_bonus,activation} → 400 |
| JNY-009 | RED | P1 | loyalty_bonus points ≤0 → 400; activation thiếu purpose → 400 |
| JNY-010 | SECURITY | P0 | role csr/analyst gọi journeys → 403 (chỉ marketer) |
| JNY-011 | SECURITY | P0 | Journey activation KHÔNG bypass consent (vẫn suppress khách chưa granted) |
| JNY-012 | EDGE | P1 | Run journey segment khớp 0 khách → triggeredCount=0, không lỗi |
| JNY-013 | DATA | P1 | Journey loyalty_bonus với segment lớn → mỗi occId cộng đúng 1 lần |
| JNY-014 | UI_CONSISTENCY | P1 | Journeys list testid journey-{id}, nút "Chạy", thẻ kết quả (Cộng điểm/Gửi/Chặn) nhất quán |
| JNY-015 | PERFORMANCE | P2 | Run journey 1000 đối tượng < 5s |

### Case chi tiết trọng yếu — Module 8

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **JNY-003** | GREEN·P0 | Đăng nhập marketer; segment khách VIP (minSpend) có occA balance ghi nhận được | 1. `/journeys`: nhập Tên "VIP bonus", Chi tiêu tối thiểu "100000", Hành động "Thưởng điểm", Số điểm 500<br>2. "Tạo journey"<br>3. Bấm "Chạy" ở dòng journey | minSpend=100000, points=500 | 1. Tạo → 201 draft<br>2. Run → thẻ "Đối tượng: N", "Cộng điểm: N"<br>3. Balance occA tăng đúng 500 |
| **JNY-005** | GREEN·P0 | Journey loyalty_bonus đã chạy lần 1 | 1. Bấm "Chạy" lần 2 cùng journey | — | 1. Điểm KHÔNG cộng lần 2 cho cùng occId (idempotencyKey journey:{runId}:{occId})<br>2. Hoặc tạo run mới nhưng đảm bảo không double-credit theo thiết kế |
| **JNY-011** | SECURITY·P0 | Journey activation purpose=marketing_email; occB CHƯA granted | 1. Run journey | occB chưa consent | 1. occB → suppressed (gate consent), KHÔNG bypass dù qua journey |
| **JNY-010** | SECURITY·P0 | Token csr | 1. `POST /v1/journeys` token csr | token csr | 1. 403 FORBIDDEN |

---

## S9.10. Module 9 — Analytics / Control Tower

**Bề mặt:** `GET /v1/analytics/overview`, `GET /v1/analytics/revenue-by-brand` (executive/analyst/marketer). Lấy từ ClickHouse + **fallback PG + circuit breaker** (CH lỗi→mở mạch 15s). Workspace **Control Tower** (`/control-tower`) auto-refresh 10s, 8 KPI.

> Lưu ý phạm vi: ClickHouse-live chưa verify (Docker dev dao động). UAT này verify qua **fallback PG** — số liệu vẫn đúng vì PG là system of record.

### Ma trận truy vết — Module 9

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| ANL-001 | GREEN | P0 | Control Tower load 8 KPI từ /analytics/overview không lỗi |
| ANL-002 | GREEN | P0 | KPI Giao dịch tăng đúng sau khi ingest đơn mới |
| ANL-003 | GREEN | P1 | KPI Doanh thu phản ánh đúng tổng total đã ingest |
| ANL-004 | GREEN | P1 | KPI Điểm khả dụng/đang giữ khớp loyalty; activation allowed/suppressed khớp |
| ANL-005 | GREEN | P1 | revenue-by-brand trả doanh thu theo từng brand |
| ANL-006 | EDGE | P0 | ClickHouse lỗi/không reachable → fallback PG, endpoint vẫn 200 (circuit breaker mở) |
| ANL-007 | EDGE | P1 | Hệ thống chưa có dữ liệu → KPI = 0, không lỗi/NaN |
| ANL-008 | SECURITY | P0 | role csr/connector gọi /analytics → 403 (chỉ executive/analyst/marketer) |
| ANL-009 | SECURITY | P0 | Không Authorization → 401 |
| ANL-010 | DATA | P1 | Số format vi-VN (1.000.000) hiển thị đúng |
| ANL-011 | UI_CONSISTENCY | P1 | Auto-refresh 10s: hiện "đang làm mới…"; loading/error state nhất quán; testid kpi-* |
| ANL-012 | PERFORMANCE | P1 | overview phản hồi < 3s kể cả khi fallback PG |

### Case chi tiết trọng yếu — Module 9

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **ANL-002** | GREEN·P0 | Đăng nhập executive; ghi nhận KPI Giao dịch hiện tại = X | 1. Mở `/control-tower`, đọc kpi-transactions = X<br>2. Ingest 1 đơn mới (connector)<br>3. Chờ ≤10s (auto-refresh) | — | 1. kpi-transactions tăng lên X+1<br>2. kpi-revenue tăng đúng total đơn vừa ingest |
| **ANL-006** | EDGE·P0 | ClickHouse dừng/không reachable | 1. Gọi `GET /v1/analytics/overview` | CH down | 1. 200 với số liệu từ PG (fallback); KHÔNG 500<br>2. Circuit breaker mở 15s, request kế không cố gọi CH |
| **ANL-008** | SECURITY·P0 | Token csr | 1. `GET /v1/analytics/overview` token csr | token csr | 1. 403 FORBIDDEN |
| **ANL-007** | EDGE·P1 | DB trống (môi trường mới) | 1. Mở Control Tower | — | 1. Mọi KPI = 0 (định dạng vi-VN), không NaN/undefined/lỗi |

---

## S9.11. Module 10 — AI cross-sell

**Bề mặt:** `GET /v1/ai/recommendations?occId=&limit?=` (marketer/analyst). Collaborative filtering từ `canonical_transaction.items`. Hiển thị trong Customer 360 (section "Gợi ý cross-sell (AI)").

### Ma trận truy vết — Module 10

| TC-ID | Loại | ƯT | Tiêu đề |
|-------|------|----|---------|
| AI-001 | GREEN | P0 | recommendations cho occ có lịch sử mua → trả danh sách {productId,score,reason} |
| AI-002 | GREEN | P1 | limit giới hạn số gợi ý trả về |
| AI-003 | GREEN | P1 | Section cross-sell hiện trong Customer 360 khi có gợi ý (testid rec-{sku}) |
| AI-004 | EDGE | P0 | occ không có lịch sử/không đủ co-visitation → trả rỗng, KHÔNG lỗi (best-effort non-blocking) |
| AI-005 | RED | P1 | Thiếu occId → 400 SCHEMA_MISSING_REQUIRED_FIELD |
| AI-006 | BOUNDARY | P1 | limit=1 (min) OK; limit=50 (max) OK; limit=51 → 400 hoặc clamp |
| AI-007 | BOUNDARY | P2 | limit=0 hoặc âm → 400/clamp về default |
| AI-008 | SECURITY | P0 | role csr/connector gọi /ai/recommendations → 403 (chỉ marketer/analyst) |
| AI-009 | SECURITY | P0 | Không Authorization → 401 |
| AI-010 | DATA | P1 | score là số hợp lệ, sắp xếp giảm dần theo độ liên quan |
| AI-011 | UI_CONSISTENCY | P1 | Lỗi AI không phá Customer 360 (lookup vẫn hiển thị; section AI ẩn) |
| AI-012 | PERFORMANCE | P2 | recommendations < 2s |

### Case chi tiết trọng yếu — Module 10

| TC-ID | Loại·ƯT | Tiền đề | Bước | Dữ liệu | Kết quả mong đợi |
|-------|--------|---------|------|---------|------------------|
| **AI-001** | GREEN·P0 | Đăng nhập marketer/analyst; occC có ≥2 đơn có items; có khách tương tự | 1. `GET /v1/ai/recommendations?occId=occC&limit=5` | occC, limit=5 | 1. 200, `{recommendations:[{productId,score,reason}...]}` ≤5 phần tử, score giảm dần |
| **AI-004** | EDGE·P0 | occD không có items/lịch sử | 1. Lookup occD ở Customer 360 | occD | 1. Customer 360 hiển thị bình thường; section cross-sell KHÔNG hiện (rỗng), không lỗi đỏ — AI best-effort non-blocking |
| **AI-008** | SECURITY·P0 | Token csr | 1. `GET /v1/ai/recommendations?occId=occC` token csr | token csr | 1. 403 FORBIDDEN |

---

# S10. Test Case liên module chi tiết (E2E / User Journey)

Thân chi tiết cho các journey P0 ở S4. Cột **Luồng dữ liệu chuyển tiếp** là điểm cốt lõi (theo dõi dữ liệu qua ranh giới module).

### E2E-J01: POS ingest → định danh → CSR tra cứu Customer 360

| Mục | Nội dung |
|-----|----------|
| **TC-ID / Loại / ƯT** | E2E-J01 / E2E / P0 |
| **User story** | Là hệ thống POS + CSR, tôi muốn đơn bán tại quầy được định danh và tra cứu được trong Customer 360 |
| **Module đi qua** | Auth(API key) → Ingestion → Identity → Customers (UI) |
| **Tiền đề** | API key connector; brand givral + store ST-GV-01; CSR đăng nhập được |
| **Các bước** | 1. [Ingest] connector `POST /v1/ingest` order_completed phone 0901234567, TXN-J01, total 200000<br>2. [UI] CSR mở `/customers`, chọn "Số điện thoại", nhập "0901234567", "Tra cứu" |
| **Luồng dữ liệu chuyển tiếp** | • phone ingest (B1) chuẩn hóa E.164 = identifier tra cứu (B2)<br>• occId sinh ở B1 = occId hiển thị B2<br>• total 200000 (B1) phản ánh vào txn-count/LTV hồ sơ B2 |
| **Kết quả mong đợi** | 1. B1 → 202 occId<br>2. B2 → thẻ Customer 360 hiện đúng occId, txn-count≥1, identifier phone<br>3. Không mất dữ liệu giữa POS và CDP |

### E2E-J02: Hợp nhất xuyên thương hiệu (2 brand, cùng phone → 1 OCC ID)

| Mục | Nội dung |
|-----|----------|
| **TC-ID / Loại / ƯT** | E2E-J02 / E2E / P0 |
| **Module đi qua** | Ingestion(×2 brand) → Identity → Customers |
| **Tiền đề** | brand givral + ktt; store mỗi brand; API key connector |
| **Các bước** | 1. Ingest đơn brand givral, phone 0905555666, TXN-A<br>2. Ingest đơn brand ktt, phone 0905555666, TXN-B<br>3. CSR lookup phone 0905555666 |
| **Luồng dữ liệu chuyển tiếp** | • phone giống nhau ở 2 brand → resolve cùng occId<br>• occId(B1)=occId(B2)=occId hiển thị(B3)<br>• txn của cả 2 brand gộp vào 1 hồ sơ |
| **Kết quả mong đợi** | 1. 2 response ingest cùng occId<br>2. Customer 360 ra 1 hồ sơ, txn-count=2, identifiers gộp xuyên brand<br>3. Không tạo 2 occId riêng |

### E2E-J03 + J04: Vòng đời loyalty (capture & rollback)

| Mục | Nội dung |
|-----|----------|
| **TC-ID / Loại / ƯT** | E2E-J03/J04 / E2E / P0 |
| **Module đi qua** | Auth → Loyalty (earn→reserve→capture / →release) |
| **Tiền đề** | CSR đăng nhập; occZ |
| **Các bước (J03)** | 1. earn 100 occZ<br>2. reserve 40 → reservation R<br>3. capture R<br>4. xem balance |
| **Các bước (J04)** | 1. earn 100 occZ'<br>2. reserve 40 → R'<br>3. release R'<br>4. xem balance |
| **Luồng dữ liệu chuyển tiếp** | • reservationId(reserve) = id dùng ở capture/release<br>• available giảm khi reserve, balance giảm khi capture, phục hồi khi release |
| **Kết quả mong đợi** | J03: balance=60, available=60, reserved=0 (đã trừ 40)<br>J04: balance=100, available=100, reserved=0 (hoàn lại); không double-spend |

### E2E-J05/J06/J11: Consent gate activation (suppress / send / withdraw giữa chừng)

| Mục | Nội dung |
|-----|----------|
| **TC-ID / Loại / ƯT** | E2E-J05/J06/J11 / E2E / P0 |
| **Module đi qua** | Identity → Consent → Segment → Activation |
| **Tiền đề** | marketer + csr/compliance đăng nhập; occP, occQ tồn tại |
| **Các bước** | J06: 1. csr grant marketing_email cho occP<br>2. marketer activation purpose=email occIds=[occP]<br>J05: 3. occQ KHÔNG grant → activation occIds=[occQ]<br>J11: 4. csr withdraw email occP → activation lại occP |
| **Luồng dữ liệu chuyển tiếp** | • consent status(occP,email) quyết định decision activation<br>• purpose activation = purpose consent check<br>• withdraw (B4) lập tức đổi kết quả gate B4 vs B2 |
| **Kết quả mong đợi** | J06: occP allowed (gửi)<br>J05: occQ suppressed_no_consent<br>J11: occP sau withdraw → suppressed (gate động, latest-wins)<br>Mọi run: total=allowed+suppressed |

### E2E-J07/J08: Journey loyalty_bonus + idempotency

| Mục | Nội dung |
|-----|----------|
| **TC-ID / Loại / ƯT** | E2E-J07/J08 / E2E / P0 |
| **Module đi qua** | Segment → Journey → Loyalty |
| **Tiền đề** | marketer; segment minSpend khớp occVIP có giao dịch |
| **Các bước** | 1. Tạo journey loyalty_bonus points=500, minSpend=100000<br>2. Run journey (lần 1)<br>3. Run journey (lần 2) |
| **Luồng dữ liệu chuyển tiếp** | • segmentCriteria → tập occId → mỗi occId earn 500 với key journey:{runId}:{occId}<br>• balance occVIP phản ánh điểm thưởng |
| **Kết quả mong đợi** | 1. Lần 1: occVIP +500<br>2. Lần 2: KHÔNG cộng trùng cho cùng (runId,occId) — chống double-credit<br>3. triggeredCount = số khách segment |

### E2E-J09/J10/J13: Cross-role & bảo mật xuyên hệ thống

| Mục | Nội dung |
|-----|----------|
| **TC-ID / Loại / ƯT** | E2E-J09/J10/J13 / E2E / P0 |
| **Module đi qua** | Platform → Login → RBAC (mọi module) |
| **Tiền đề** | admin đăng nhập |
| **Các bước** | J09: 1. admin tạo user role csr (`POST /v1/auth/users`)<br>2. đăng nhập user csr → chỉ thao tác được phần csr<br>J10: 3. admin tạo API key connector → connector ingest OK<br>J13: 4. user csr cố gọi `GET /v1/auth/users`, `POST /v1/activation`, `POST /v1/segments/preview` |
| **Luồng dữ liệu chuyển tiếp** | • role gán khi tạo user (B1) = role enforce mọi request (B2,B4)<br>• rawKey tạo B3 = Bearer dùng ingest |
| **Kết quả mong đợi** | J09: user csr login OK, gọi endpoint ngoài role → 403<br>J10: connector ingest 202<br>J13: tất cả endpoint ngoài role csr → 403 (deny-by-default), không leo thang quyền |

---

# S11. Dữ liệu kiểm thử (Test Data Reference)

### S11.1. Tài khoản người dùng (UI / token)
| ID | Username | Mật khẩu | Role | Trạng thái | Ghi chú |
|----|----------|----------|------|------------|---------|
| U-ADM | admin | admin12345 | admin | active | Dev seed; toàn quyền |
| U-DS | steward1 | Steward@123 | data_steward | active | Master data CRUD |
| U-MKT | mkt1 | Market@123 | marketer | active | Activation/journey/segment/AI/analytics |
| U-CSR | csr1 | Csr@12345 | csr | active | Loyalty/consent/lookup |
| U-ANL | analyst1 | Analyst@123 | analyst | active | Analytics/segment/AI/balance |
| U-CMP | comp1 | Comply@123 | compliance | active | Consent |
| U-EXE | exec1 | Exec@1234 | executive | active | Analytics/lookup read-only |
| U-DIS | disabled1 | Disable@123 | marketer | disabled | Test login bị từ chối |

### S11.2. API key
| ID | Tên | Role | Trạng thái | Dùng cho |
|----|-----|------|------------|----------|
| K-CONN | POS connector key | connector | active | Ingestion |
| K-REV | revoked key | connector | revoked | Test 401 sau revoke |

### S11.3. Master data nền
| Loại | Giá trị |
|------|---------|
| Brand (seed) | givral, ktt (Kem Tràng Tiền), hhk (Hải Hà Kotobuki), fuji, origato |
| Store | ST-GV-01 (givral, TP.HCM), ST-KTT-01 (ktt, Hà Nội) |
| Product | PRD-CAKE-01 "Bánh kem" (unit "cái"), PRD-TEA-01 "Trà sữa" |

### S11.4. Định danh & giao dịch mẫu
| occ ref | Identifier | Giao dịch | Mục đích test |
|---------|------------|-----------|---------------|
| occP | phone 0901234567 | TXN-J01 givral 200k | Happy lookup, consent granted |
| occQ | email q@test.com | TXN-Q ktt 80k | Consent chưa granted → suppress |
| occVIP | phone 0907778899 | nhiều đơn ≥100k | Segment/journey bonus |
| (cross) | phone 0905555666 | givral TXN-A + ktt TXN-B | Hợp nhất xuyên brand |

### S11.5. Giá trị biên
| Trường | Min-1 (fail) | Min (pass) | Max (pass) | Max+1 (fail) |
|--------|--------------|------------|------------|--------------|
| Username (tạo user) | 2 ký tự | 3 ký tự | 100 ký tự | 101 ký tự |
| Password (tạo user) | 7 ký tự | 8 ký tự | 200 ký tự | 201 ký tự |
| Loyalty points | 0 | 1 | safe int max | > safe int |
| Activation occIds | 0 (rỗng) | 1 | 100.000 | 100.001 |
| AI limit | 0 | 1 | 50 | 51 |
| Consent evidence | — | 0 | 2000 ký tự | 2001 ký tự |

### S11.6. Dữ liệu không hợp lệ (RED/DATA)
| Trường | Giá trị không hợp lệ | Lý do |
|--------|----------------------|-------|
| Phone | "abc", "123" | Không chuẩn hóa được E.164 VN |
| Email | "alice@", "alice test.com" | Thiếu domain / có space |
| ingest type | "page_view" | UNKNOWN_EVENT_TYPE |
| consent purpose | "marketing_tiktok" | Ngoài enum |
| loyalty points | -5, 0 | INVALID_AMOUNT |
| lookup value | `' OR 1=1--`, `<script>` | SQL/XSS injection |
| occ_timestamp | "2026-06-18 10:30" | Thiếu offset ISO |

---

# S12. Checklist độ phủ (Coverage Checklist)

| Loại | Số TC | Ghi chú |
|------|-------|---------|
| GREEN | 38 | Mỗi flow chính mỗi module |
| RED | 33 | Mỗi lớp input sai có ý nghĩa + state sai (loyalty/idempotency) |
| EDGE | 16 | Đơn 0đ, occ không lịch sử, CH down fallback, segment 0 khách |
| BOUNDARY | 16 | Username/password/points/occIds/limit/evidence min±1, max±1 |
| SECURITY | 31 | Auth/RBAC mọi module (deny-by-default), IDOR/injection, alg-confusion, revoke, rate-limit, race |
| DATA | 18 | Chuẩn hóa phone/email, UTF-8 tiếng Việt, survivorship, vi-VN format |
| PERFORMANCE | 11 | < 2-3s mỗi action chính; concurrency nhẹ |
| UI_CONSISTENCY | 11 | UX State Contract, badge/màu/format, App shell 8 workspace |
| E2E (liên module) | 13 (J01–J13, gộp ở S10) | Pipeline khép kín ingest→identity→loyalty/segment→activation(gate consent)→analytics |
| **Tổng** | **≈ 180 case** | Vượt sàn ISO/ISTQB cho hệ thống 11 module (≥60-200) |

**Đối chiếu sàn mật độ S9:** mọi module nghiệp vụ đạt ≥12 case (Auth 28, Master 20, Ingestion 23, Identity 18, Loyalty 23, Consent 18, Activation 17, Segment 13, Journey 15, Analytics 12, AI 12) — không module nào dưới sàn.

---

# S13. Nhận định trải nghiệm & Đề xuất cải tiến (góc nhìn user thật)

| ID | Mức độ | Loại vấn đề | Mô tả quan sát | Tác động | Đề xuất cải tiến |
|----|--------|-------------|----------------|----------|------------------|
| UX-01 | Trung bình | Thao tác rườm rà | Loyalty/Consent/Customers đều yêu cầu dán **OCC ID/định danh thủ công**; không có liên kết "mở Loyalty/Consent của khách này" từ thẻ Customer 360 | CSR phải copy-paste occId giữa các workspace, dễ nhầm | Thêm deep-link từ Customer 360 sang Loyalty/Governance kèm occId điền sẵn |
| UX-02 | Trung bình | Luồng dữ liệu phi lý | Audiences nhập **danh sách OCC ID thủ công** tách rời Segment Builder ở trên cùng trang — user phải tự copy occIds từ preview xuống textarea | Dễ rớt/sai occId, mất công | Nút "Đưa kết quả segment vào activation" tự đổ occIds vào textarea |
| UX-03 | Cao | Thiếu phản hồi/định danh người dùng | Reservation/“Đơn giữ trong phiên” chỉ tồn tại trong phiên trình duyệt; reload mất danh sách reservation đang held | CSR reload → không thấy đơn giữ để chốt/hủy | Tải lại reservation đang held theo occId từ server khi xem số dư |
| UX-04 | Thấp | Nhất quán | Một số workspace dùng "—" cho giá trị trống (Data Ops), nơi khác "(chưa có tên)" (Customers) | Hiển thị trống không đồng nhất | Thống nhất placeholder rỗng toàn hệ thống |
| UX-05 | Tích cực | — | UX State Contract (idle/loading/notfound/error/success) áp dụng nhất quán; Control Tower auto-refresh + chỉ báo "đang làm mới…" rõ ràng; deny-by-default ghi rõ trên Audiences | Tăng tin cậy, đúng tinh thần "control tower" | Giữ và mở rộng pattern này cho mọi màn mới |
| UX-06 | Trung bình | Error message | Lỗi API hiển thị `error.message` thô; chưa luôn dùng `why/fix` trong envelope để hướng dẫn user | User kỹ thuật thấp khó tự sửa | Hiển thị `fix` từ error envelope như gợi ý hành động |

---

# S14. Tóm tắt quyết định release (UAT Sign-off)

| Tiêu chí | Ngưỡng | Thực tế (chạy 2026-06-18) | Đạt? |
|----------|--------|---------|------|
| P0 pass (tự động) | 100% | 72/72 | ✅ |
| P1 pass (tự động) | ≥95% | 6/6 (100%) | ✅ |
| Tổng test tự động | — | **78/78** (API gate 64 + UI E2E 14) | ✅ |
| Lỗi Nghiêm trọng/Cao đang mở | 0 | 0 | ✅ |
| E2E P0 qua UI thật (J01/J03/J06) | 100% | 3/3 | ✅ |
| Bảo mật RBAC deny-by-default (mọi module) | 0 leo thang | 0 (15 case 403 đúng kỳ vọng) | ✅ |
| Consent chokepoint (chỉ activation gate) | đúng | đúng (ING-021 nhận, ACT-002/J11 chặn) | ✅ |
| **Khuyến nghị** | | | **GO (cho scope GĐ1)** — xem ghi chú |

**Ghi chú GO:** phạm vi tự động hóa lần này = slice rủi ro P0/P1 của 11 module (78 case). Các hạng mục out-of-scope (ClickHouse-live verify, rate-limit distributed, RudderStack, load test chuyên sâu) chưa nằm trong lần chạy này — xem S1 out of scope. Các case còn lại trong S9 (BOUNDARY/DATA/PERFORMANCE/UI_CONSISTENCY mức chi tiết) khuyến nghị bổ sung ở vòng UAT tiếp theo và tầng expert-test. Báo cáo đầy đủ: `uat_report.md`.

**Thứ tự chạy khi bị cắt thời gian (risk-based):** SMK-01→06 → Auth/RBAC P0 (AUTH/PLAT) → Consent+Activation gate P0 (CON/ACT/J05/J06/J11) → Loyalty P0 (LOY) → Ingestion+Identity P0 (ING/ID/J01/J02) → Journey idempotency (JNY/J07/J08) → còn lại.

---

# S15. Self-audit (bắt buộc trước khi kết thúc)

- [x] MỌI module trong S1 (11) đã có khối FEATURE-LEVEL chi tiết riêng (S9.1–S9.11) — không module nào chỉ nằm trong bảng kế hoạch.
- [x] Mỗi module đạt SÀN mật độ (≥12 case/module nghiệp vụ; module nền Auth 28).
- [x] Mỗi field nhập liệu quan trọng có GREEN + RED + BOUNDARY (username/password/points/total/occIds/limit/evidence).
- [x] Mỗi cặp tích hợp S3 có ≥1 E2E thân đầy đủ (gộp trong S10: J01–J13).
- [x] Mỗi journey S4 có thân E2E chi tiết (S10) với cột Luồng dữ liệu chuyển tiếp.
- [x] Tổng ≈180 case ≥ sàn cho hệ thống 11 module (60–200+).
- [x] SECURITY phủ deny-by-default RBAC trên TẤT CẢ module + IDOR/injection/alg-confusion/rate-limit/race.
- [x] Consent chokepoint khẳng định: ingestion & loyalty không gate, chỉ activation/journey-activation gate.

**Câu hỏi mở còn lại cho PO/BA:** xem S8 (JWT TTL, ngưỡng rate-limit production, trần điểm/TTL reservation, purpose theo PDPD VN, SLA activation 100k, định danh lookup trên UI, brand chỉ-đọc UI).

> **Kết thúc giai đoạn WRITE.** Bước tiếp theo theo quy trình dự án: chuyển bộ này sang **`/uat-test-runner-web`** để sinh script Playwright (API smoke gate + UI E2E Chromium) và chạy thật, đối chiếu Kết quả mong đợi → điền S14 và xuất GO/NO-GO.

