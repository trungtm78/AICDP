# Danh mục kiểm thử TẦNG CHUYÊN GIA — Hệ thống OCC-CDP (SYSTEM-WIDE)

> Tầng TRÊN UAT (UAT đã 78/78 PASS). Mục tiêu: CHỨNG MINH hệ đúng/bền/an toàn dưới MỌI input, và đo chính bộ test có bắt được bug không (mutation).
> Vai WRITER: chỉ ĐƯA DANH MỤC CASE + bất biến/oracle. KHÔNG sinh code, KHÔNG kết luận đạt/không, KHÔNG đề xuất sửa.
> Stack: TypeScript + vitest (core-api) → runner dùng **fast-check** (property/metamorphic/stateful), **Stryker** (mutation), **autocannon/k6** (perf), Postgres thật. Domain: CDP F&B (định danh + điểm thưởng + consent + activation).

---

## W1. Mô hình rủi ro & Bất biến/oracle (phát hiện qua 8 lớp)

| Vùng rủi ro | Mức | Bất biến/oracle cần đúng | Lớp |
|-------------|-----|--------------------------|-----|
| **Loyalty — sổ điểm double-entry** | Cao | Σ delta mỗi bút toán = 0 (đối ứng); available = Σ(earn) − Σ(reserved chưa release) − Σ(captured); available ≥ 0 và reserved ≥ 0 LUÔN (cấm âm) | 1,2,4 |
| **Loyalty — state machine reservation** | Cao | held→{captured\|released} một chiều; sau captured/released KHÔNG transition tiếp; mỗi reservation chỉ tiêu điểm đúng 1 lần | 6 |
| **Loyalty — idempotency** | Cao | earn/reserve cùng idempotencyKey + cùng payload ⇒ tác động == gọi 1 lần; cùng key + khác payload ⇒ reject (IDEMPOTENCY_CONFLICT), KHÔNG ghi | 6 |
| **Loyalty — concurrency** | Cao | N reserve đồng thời tổng > available ⇒ chỉ tập con ≤ available thành công; tổng điểm tiêu ≤ điểm có (advisory lock, không oversell) | 1,3 |
| **Ingestion — idempotency** | Cao | Cùng `{brand}:{store}:{pos_transaction_id}` ⇒ đúng 1 canonical_transaction dù gọi/đua bao nhiêu lần (idempotent=true từ lần 2) | 6 |
| **Identity — resolve OCC ID** | Cao | Cùng identifier chuẩn hóa ⇒ luôn cùng occId (hàm thuần theo trạng thái); UNIQUE(identifier_type, value_normalized); resolve đua không tạo 2 occId (advisory lock) | 1,3 |
| **Identity — chuẩn hóa** | Cao | normalize idempotent: normalize(normalize(x))==normalize(x); mọi biểu diễn cùng SĐT (0..,+84..,84..) ⇒ cùng value_normalized; email lowercase/trim | 6 |
| **Identity — merge non-destructive** | Cao | merge 2 occId ⇒ không mất identifier/giao dịch nào; tổng giao dịch sau merge = Σ trước; không "un-merge" mất dữ liệu | 1 |
| **Consent — deny-by-default** | Cao | Không có bản ghi granted active ⇒ check = false; chỉ activation/journey-activation gate, ingestion & loyalty KHÔNG gate (cô lập chokepoint) | 3,8 |
| **Consent — append-only + latest-wins** | Cao | Không UPDATE/DELETE được (trigger DB chặn); check phản ánh bản ghi MỚI NHẤT theo (occ,purpose); lịch sử bất biến | 7 |
| **Consent — cô lập purpose/occ** | TB | granted purpose A KHÔNG ảnh hưởng purpose B; consent occ X KHÔNG ảnh hưởng occ Y | 3 |
| **Activation — bảo toàn đếm** | Cao | total = allowedCount + suppressedCount; allowed[] ⊆ occIds đầu vào; occ chưa granted ⇒ luôn ∈ suppressed | 1,3 |
| **Activation — gate động** | Cao | Quyết định dùng consent HIỆN TẠI (latest-wins): granted→withdraw rồi activate ⇒ suppressed | 6,8 |
| **RBAC — deny-by-default** | Cao | Mọi endpoint không khai @Public ⇒ role ngoài danh sách @Roles bị 403; thiếu/sai token ⇒ 401; admin wildcard; route quên @Roles vẫn deny | 8 |
| **Auth — token** | Cao | JWT sai chữ ký/alg=none/hết hạn ⇒ 401; API key revoked ⇒ 401; disable user ⇒ request kế 401/403 (role đọc DB mỗi request) | 8 |
| **Error envelope** | TB | Mọi lỗi ⇒ envelope đủ field {code,message,why,fix,field_path,correlation_id,retryable,schema_version}; không 500 trần; không nuốt data | 7 |
| **Analytics — resilience** | TB | ClickHouse down ⇒ fallback PG, endpoint vẫn 200 (circuit breaker); KPI không NaN khi DB rỗng | 2 |
| **Số tiền/điểm — biên** | Cao | total=0 (đơn free) hợp lệ; điểm ≤0 reject; vượt safe integer reject, không tràn | 4 |

**Lớp 5 (scale/cộng tính):** áp cho loyalty (×k điểm ⇒ ×k balance) và activation (gộp 2 danh sách occId ⇒ tổng allowed cộng dồn). **Lớp 7 (chuẩn ngành):** consent audit hash-chain/append-only phục vụ kiểm toán IPO. Không lớp nào N/A.

---

## W2. Bản đồ phương pháp (rủi ro → method)

| Vùng | Phương pháp chính | Phương pháp phụ | Lý do |
|------|-------------------|-----------------|-------|
| Loyalty ledger (số học điểm) | property-based | metamorphic (scale ×k) | bất biến bảo toàn/cấm âm rõ, miền input rộng |
| Loyalty reservation lifecycle | model-based/stateful | property (idempotency) | nhiều transition + ràng buộc một chiều |
| Loyalty concurrency | stateful + performance (concurrent) | property | đua reserve/capture, advisory lock |
| Ingestion idempotency | property-based | stateful | key unique, retry/đua |
| Identity normalize | property-based | metamorphic (idempotent, đa biểu diễn) | hàm thuần, miền chuỗi rộng |
| Identity resolve/merge | property + differential | stateful | invariant hợp nhất + so PG là nguồn chuẩn |
| Consent | model-based/stateful + property | security | vòng đời granted/withdrawn + append-only |
| Activation gate | property-based | metamorphic | bảo toàn đếm + gate động |
| RBAC/Auth | security/pentest (matrix) | differential (role×endpoint) | bề mặt tấn công vượt quyền |
| Ingestion payload parser | fuzzing | property | đầu vào ngoài (POS), dễ méo |
| Toàn bộ logic core | **mutation testing** | — | đo bộ test có bắt bug |
| Analytics | golden-master (PG là baseline) | — | fallback PG = nguồn chuẩn |

---

## W3. DANH MỤC CASE theo phương pháp

### W3.1 Property-based (fast-check)

| ID | Hàm/đối tượng | Miền input (strategy) | BẤT BIẾN phải giữ |
|----|---------------|-----------------------|-------------------|
| PB-01 | loyalty: chuỗi earn | n earn points∈[1,1e6], cùng occId | available cuối = Σ points; reserved=0 |
| PB-02 | loyalty: earn rồi reserve | earn E, reserve R≤E | available = E−R; reserved = R; cả hai ≥0 |
| PB-03 | loyalty: reserve > available | reserve R > available | luôn 409 INSUFFICIENT_BALANCE; state bất biến |
| PB-04 | loyalty: earn idempotent | cùng key, cùng points, lặp k lần | available chỉ +points 1 lần |
| PB-05 | loyalty: earn conflict | cùng key, points khác | luôn 409 IDEMPOTENCY_CONFLICT; không ghi |
| PB-06 | loyalty: cấm âm toàn cục | chuỗi ngẫu nhiên earn/reserve/capture/release | ∀ thời điểm available≥0 ∧ reserved≥0 |
| PB-07 | loyalty: bảo toàn | bất kỳ chuỗi thao tác | Σ delta ledger = 0; balance = projection tính lại từ ledger |
| PB-08 | normalize(phone) idempotent | chuỗi số VN hợp lệ + nhiễu (space, +84, 84, 0) | normalize∘normalize == normalize; mọi dạng cùng số ⇒ cùng output |
| PB-09 | normalize(email) | email hợp lệ + hoa/space/đuôi | lowercase, trim; idempotent; email khác nhau ⇒ output khác |
| PB-10 | normalize reject | chuỗi rác/không phải định danh | trả lỗi/null nhất quán, không ném exception lạ |
| PB-11 | identity resolve hàm theo trạng thái | cùng identifier chuẩn hóa, gọi nhiều lần | luôn cùng occId |
| PB-12 | ingestion idempotency | cùng {brand,store,pos_txn}, payload bằng, lặp k | đúng 1 transaction; idempotent=true từ lần 2 |
| PB-13 | activation bảo toàn đếm | tập occId ngẫu nhiên (mix granted/chưa) | total=allowed+suppressed; allowed⊆input |
| PB-14 | activation deny-by-default | occId chưa granted purpose P | luôn ∈ suppressed |
| PB-15 | consent latest-wins | chuỗi granted/withdrawn ngẫu nhiên cho (occ,purpose) | check == trạng thái bản ghi cuối |
| PB-16 | error envelope đầy đủ | mọi request lỗi (400/401/403/404/409) | envelope đủ field bắt buộc; correlation_id là uuid |

### W3.2 Metamorphic

| ID | Phép biến đổi | Quan hệ phải giữ |
|----|---------------|------------------|
| MR-01 | nhân mọi lượng earn ×k (k nguyên dương) | available ×k |
| MR-02 | tách 1 earn(P) thành earn(P1)+earn(P2), P1+P2=P (key khác) | available bằng nhau |
| MR-03 | gộp 2 activation danh sách occId rời nhau | allowed tổng = Σ allowed từng phần (cô lập) |
| MR-04 | ingest cùng đơn qua 2 định dạng phone của 1 người | cùng occId, txn-count không nhân đôi (idempotent theo pos_txn) |
| MR-05 | thêm 1 khách granted vào audience | allowedCount tăng đúng 1, suppressed giữ nguyên |
| MR-06 | đảo thứ tự các identifier trong 1 ingest | occId resolve không đổi (hoán vị bất biến) |
| MR-07 | reserve(R) rồi release == không làm gì (về available) | available trước == sau (đảo nghịch) |

### W3.3 Golden-master / approval

| ID | Đối tượng | Nguồn chuẩn | So sánh |
|----|-----------|-------------|---------|
| GM-01 | analytics/overview | PG aggregate (system of record) | số liệu CH (khi có) == PG; khi CH down, fallback == PG |
| GM-02 | customer 360 lookup | snapshot hồ sơ đã duyệt cho bộ seed cố định | identifiers + transactions khớp baseline |
| GM-03 | revenue-by-brand | PG GROUP BY brand | từng brand revenue khớp baseline |

### W3.4 Model-based / stateful (fast-check model + commands)

| ID | State machine | Transition hợp lệ | Phải CHẶN (bất hợp lệ) | Invariant sau mỗi bước |
|----|---------------|-------------------|------------------------|------------------------|
| SF-01 | reservation | created(held)→capture(captured); held→release(released) | capture sau captured/released; release sau captured; capture/release reservation lạ | reserved≥0; điểm tiêu ≤ điểm earn |
| SF-02 | balance qua chuỗi lệnh | earn/reserve/capture/release tùy ý | reserve quá available | available = recompute(ledger); ≥0 |
| SF-03 | consent (occ,purpose) | grant→withdraw→grant… (append) | UPDATE/DELETE bản ghi cũ (qua DB) | check == bản cuối; số bản ghi chỉ tăng |
| SF-04 | user account | active→disabled→active (admin) | login khi disabled; dùng token sau disable | role/status hiệu lực == DB hiện tại |
| SF-05 | api key | active→revoked | dùng key sau revoke | revoked ⇒ 401 vĩnh viễn |

### W3.5 Fuzzing (payload POS / query)

| ID | Bề mặt | Loại input méo | Kỳ vọng |
|----|--------|----------------|---------|
| FZ-01 | POST /v1/ingest body | JSON thiếu/thừa field, kiểu sai, null, mảng rỗng | 400 envelope, không 500/crash |
| FZ-02 | identifiers[] | phone/email rác, unicode, zero-width, emoji, chuỗi dài 10KB | INVALID_IDENTIFIER hoặc bỏ qua có kiểm soát |
| FZ-03 | occ_timestamp | thiếu offset, ngày 29/02 không nhuận, năm 0000/9999, chuỗi rác | 400 SCHEMA_TYPE_MISMATCH |
| FZ-04 | properties.total | NaN, Infinity, "1e309", âm, chuỗi, số rất lớn | reject có kiểm soát, không tràn/NaN vào DB |
| FZ-05 | query lookup value | SQL/NoSQL injection, `%`, `*`, path traversal, %00 | 400/404 an toàn, không lộ, không injection |
| FZ-06 | loyalty points / occId | UUID sai định dạng, points phân số, âm, overflow | 400 INVALID_AMOUNT / SCHEMA_TYPE_MISMATCH |
| FZ-07 | Authorization header | "Bearer ", "Bearer x.y.z" rác, JWT alg=none, token cắt ngắn | 401 nhất quán, không leak stacktrace |

### W3.6 Performance / load

| ID | Kịch bản | Quy mô | Ngưỡng/điều cần đúng |
|----|----------|--------|----------------------|
| PF-01 | ingest đồng thời khác pos_txn | 200–1000 req, concurrency 50 | đều 202; p95 < 1s; không lỗi |
| PF-02 | ingest đua CÙNG pos_txn | 50 req cùng key song song | đúng 1 transaction; còn lại idempotent |
| PF-03 | reserve đua trên 1 occId | 50 reserve, tổng > available | không oversell; tổng tiêu ≤ available |
| PF-04 | lookup dataset lớn | ≥100k identifier | p95 < 2s (materialized resolved_identifier) |
| PF-05 | activation occIds lớn | 100.000 occId | hoàn tất < SLA; total=allowed+suppressed đúng |
| PF-06 | segment preview | dataset lớn | < 3s; count = occIds.length |
| PF-07 | analytics overview khi CH down | — | fallback PG < 3s, circuit breaker mở |

### W3.7 Security / pentest

| ID | Vector | Mục tiêu | Kỳ vọng |
|----|--------|----------|---------|
| SEC-01 | RBAC matrix đầy đủ | 8 role × mọi endpoint | mỗi ô role-ngoài-quyền ⇒ 403; đúng quyền ⇒ 2xx |
| SEC-02 | thiếu @Roles (deny-by-default) | route nội bộ | role thường ⇒ 403; chỉ admin/@Public qua |
| SEC-03 | alg-confusion | JWT alg=none / HS↔RS | 401, không tin payload |
| SEC-04 | token của user khác / giả sub | đổi sub trong JWT | chữ ký fail ⇒ 401 |
| SEC-05 | disable user / revoke key giữa phiên | token/key cũ | 401/403 ngay (đọc DB mỗi request) |
| SEC-06 | IDOR | lookup/activation occId người khác qua role thấp | chỉ trả theo quyền; không lộ occ ngoài phạm vi |
| SEC-07 | injection | lookup value, audienceName, consent evidence | không thực thi SQL; lưu/escape đúng |
| SEC-08 | consent tamper | thử sửa/xóa bản ghi consent (API + DB) | không có API mutate; trigger DB chặn UPDATE/DELETE |
| SEC-09 | rate-limit bypass | spam login/IP, đổi tên principal | 429 theo principalId/IP, không bypass bằng đổi display-name |
| SEC-10 | consent chokepoint leak | ingest/loyalty cho occ chưa consent | vẫn nhận (đúng); chỉ activation chặn — xác nhận không gate nhầm |

### W3.8 Differential

| ID | Hệ A vs Hệ B | Input chung | Chỗ lệch = bug |
|----|--------------|-------------|----------------|
| DF-01 | balance qua API vs recompute trực tiếp từ ledger PG | cùng occId | phải bằng nhau |
| DF-02 | analytics CH vs PG | cùng khoảng dữ liệu | số liệu phải khớp (sai số làm tròn = 0 cho count, khớp cho revenue) |
| DF-03 | resolve occId qua API vs query resolved_identifier table | cùng identifier | cùng occId |
| DF-04 | activation count vs đếm thủ công consent granted trong tập | cùng occIds+purpose | allowedCount == số granted |

### W3.9 Mutation testing (targets — đo chất lượng bộ test)

| ID | Module mục tiêu Stryker | Mutant kỳ vọng bị KILL bởi test | Mutant sống = lỗ hổng |
|----|-------------------------|----------------------------------|------------------------|
| MT-01 | loyalty service (ledger/projection) | đổi `>=`→`>` ở check available; xóa cộng delta; đảo dấu | nếu sống ⇒ test không phủ biên/bảo toàn |
| MT-02 | loyalty state machine | bỏ check trạng thái captured; cho capture 2 lần | sống ⇒ thiếu test SF-01 |
| MT-03 | identity normalize | bỏ trim/lowercase; đổi regex E.164 | sống ⇒ thiếu PB-08/09 |
| MT-04 | identity resolve | bỏ advisory lock branch; đổi ON CONFLICT | sống ⇒ thiếu test đua |
| MT-05 | consent isAllowed | đổi default true; bỏ latest-wins ORDER | sống ⇒ thiếu PB-14/15 (NGUY HIỂM: deny-by-default) |
| MT-06 | activation gate | bỏ lọc consent; đổi allowed/suppressed | sống ⇒ thiếu PB-13/14 |
| MT-07 | RolesGuard | đổi deny-by-default thành allow; bỏ check role | sống ⇒ thiếu SEC-01/02 (NGUY HIỂM) |
| MT-08 | ingestion idempotency | bỏ unique key check; đổi key cấu thành | sống ⇒ thiếu PB-12 |

**Mục tiêu kill-rate đề xuất runner:** ≥85% toàn cục; **100% cho module tiền/danh-tính/consent/RBAC** (MT-01,02,05,06,07). Mutant sống ở các module này = blocker.

---

## W4. Checklist MÀN HÌNH & LUỒNG cho RUNNER quan sát (đánh giá UX)

| ID | Màn/Luồng | Điểm cần soi |
|----|-----------|--------------|
| UX-S01 | Control Tower | 8 KPI: empty/loading/error; "đang làm mới"; format vi-VN; auto-refresh 10s có giật layout? |
| UX-S02 | Customer 360 | idle/loading/notfound/error/success; thẻ hồ sơ + cross-sell; guard stale-response khi tra cứu liên tiếp |
| UX-S03 | Loyalty | reservation mất khi reload (không tải lại từ server?); phản hồi sau earn/reserve; format số |
| UX-S04 | Governance/Consent | badge màu granted/withdrawn/denied; nút Cấp/Thu hồi disable đúng; 5 purpose nhất quán |
| UX-S05 | Audiences | segment builder tách rời textarea occId — phải copy thủ công?; thẻ kết quả allowed/suppressed màu |
| UX-S06 | Journeys | mô tả action; nút Chạy; thẻ kết quả; trạng thái journey |
| UX-S07 | Data Ops | 3 panel empty/loading/error; placeholder "—"; double-submit |
| UX-S08 | Platform | rawKey hiện 1 lần; badge status; bảng user/key |
| UX-F01 | Ingest→Customer360→Loyalty→Consent (1 khách) | phải dán lại occId mỗi workspace? thiếu deep-link giữa màn? |
| UX-F02 | Segment→Activation | kết quả preview có tự đổ vào activation? hay copy tay? |
| UX-F03 | Login→điều hướng role | role thấp thấy workspace không dùng được? phản hồi 403 trên UI ra sao? |

---

## W5. Câu hỏi cho chuyên gia domain (giả định cần xác nhận)

1. **Loyalty:** reservation có TTL tự release không? Trần điểm tối đa mỗi giao dịch/mỗi occId? Điểm có hết hạn (expiry ledger) không — nếu có là thêm một lớp bất biến thời gian.
2. **Journey:** chạy journey loyalty_bonus 2 lần (2 runId) CỐ Ý cộng điểm 2 lần (đúng thiết kế) hay phải idempotent toàn cục theo journey? (UAT ghi nhận mỗi run là sự kiện riêng — cần chốt để viết property idempotency đúng tầng.)
3. **Identity merge:** điều kiện auto-merge 2 occId là gì (cùng phone? cùng email?)? Có ngưỡng/àuy tắc survivorship cho trait xung đột (tên khác nhau)?
4. **Consent:** purpose nào bắt buộc theo PDPD VN cần deny cứng? Có yêu cầu hash-chain/anchor ngoài cho audit IPO ở tầng này chưa?
5. **Activation:** ngưỡng 100.000 occId/run — vượt thì reject hay chia batch? SLA thời gian?
6. **Phân số/tiền tệ:** total đa tiền tệ (USD/VND) có chuẩn hóa không, hay 1 brand 1 currency?
7. **Differential analytics:** sai số làm tròn cho phép giữa CH và PG là bao nhiêu (revenue)?

---

**Self-check:** ✅ bất biến qua đủ 8 lớp (5,7 đã nêu áp dụng); ✅ mỗi vùng rủi ro Cao có ≥1 phương pháp; ✅ state machine → W3.4 (5 máy); ✅ parser/đầu-vào-ngoài → W3.5 fuzz; ✅ checklist UX W4; ✅ không kết luận đạt/không, không đề xuất sửa.

> **Danh mục sẵn sàng — chạy `expert-test-runner` để thực thi + mutation + đánh giá UX + phán xét GO/NO-GO.**
