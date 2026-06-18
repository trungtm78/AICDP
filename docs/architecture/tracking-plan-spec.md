# Tracking Plan Spec — OCC-CDP (v1)

**Trạng thái:** v1 (GĐ1). Đây là **source-of-truth** cho schema sự kiện đa thương hiệu. Mọi schema registry, SDK types, validation và tài liệu phải sinh/đối chiếu từ tài liệu này. Không sửa rời rạc ở nơi khác.

`schema_version` hiện tại: **1**.

---

## 1. Nguyên tắc

- **Schema-on-write:** event được validate tại biên thu thập theo spec này.
- **Idempotency toàn tuyến:** mọi event mang `message_id` ổn định; trùng = no-op.
- **Consent layering:** ingestion + loyalty **LUÔN nhận** giao dịch (không chặn vì consent). Chỉ **activation** mới gate theo consent. Lý do: không được mất dữ liệu giao dịch hợp pháp.
- **Provenance:** mọi event ghi `brand_id`, `source`, `received_at`, `schema_version`.
- **Chuẩn hóa trước khi khớp danh tính** (mục 3).

## 2. Định danh & chuẩn hóa (normalization)

`identifier_type` (enum) và quy tắc chuẩn hóa `value_normalized`:

| type | mô tả | chuẩn hóa |
|---|---|---|
| `phone` | SĐT (định danh mạnh) | E.164 VN: bỏ ký tự không phải số; `0XXXXXXXXX`→`+84XXXXXXXXX`; `84…`→`+84…`; giữ `+84` nếu đã đúng. Hợp lệ: `+84` + 9 chữ số bắt đầu 3/5/7/8/9. |
| `email` | Email (định danh mạnh) | trim, lowercase, NFC. |
| `loyalty_card` | Mã thẻ loyalty | trim, uppercase. |
| `pos_member_id` | Mã KH trong POS từng brand | `"{brand_id}:{raw}"` (scope theo brand). |
| `web_anonymous_id` | anonymousId web | giữ nguyên (UUID). |
| `app_anonymous_id` | anonymousId app | giữ nguyên. |
| `social_lead_id` | Lead FB/TikTok/Zalo | `"{provider}:{raw}"`. |

**Định danh mạnh** (đủ để deterministic-merge): `phone`, `email`, `loyalty_card`, `pos_member_id`.
**Định danh yếu** (chỉ stitch khi user định danh): `web_anonymous_id`, `app_anonymous_id`.
Chuẩn hóa thất bại (vd phone sai định dạng) → identifier bị **bỏ qua khi resolve** (không tạo OCC ID rác), event vẫn được nhận và gắn cờ `invalid_identifier`.

## 3. Trường chung (envelope) cho mọi event

```jsonc
{
  "message_id": "string",      // idempotency key, ổn định (xem từng event)
  "type": "identify | order_completed | order_refunded",
  "schema_version": 1,
  "brand_id": "givral | kem_trang_tien | hai_ha_kotobuki | fuji | origato",
  "source": "pos | web | app | ecommerce | import | webhook",
  "store_id": "string|null",   // bắt buộc cho source=pos
  "occ_timestamp": "ISO8601",  // thời điểm sự kiện xảy ra (giờ VN)
  "identifiers": [             // 0..n định danh
    { "type": "phone", "value": "0901234567" }
  ],
  "traits": { },               // thuộc tính KH (identify)
  "properties": { },           // dữ liệu nghiệp vụ (order_*)
  "consent": [                 // tùy chọn: consent thu tại điểm thu thập
    { "purpose": "marketing", "status": "granted|denied", "captured_at": "ISO8601" }
  ]
}
```

## 4. Event: `identify`

Khai báo/ cập nhật một khách hàng và các định danh.
- `message_id` = `"identify:{brand_id}:{stable_hash(identifiers)}:{occ_timestamp}"` (hoặc do nguồn cấp).
- `traits` (tất cả optional): `full_name`, `phone`, `email`, `birth_date` (YYYY-MM-DD), `gender` (`male|female|other|unknown`), `address`, `city`.
- **Side effect:** resolve → OCC ID; ghi/cập nhật identity edges + golden record (survivorship).

## 5. Event: `order_completed` (POS — lõi GĐ1)

Một giao dịch mua hoàn tất.
- **`message_id` = `"{brand_id}:{store_id}:{pos_transaction_id}"`** (khóa idempotency bắt buộc; replay = no-op).
- `properties`:
```jsonc
{
  "pos_transaction_id": "string",   // bắt buộc
  "currency": "VND",
  "total": 0,                       // số nguyên VND, >= 0
  "payment_method": "cash | card | ewallet | qr | other",
  "cashier_id": "string|null",
  "business_date": "YYYY-MM-DD",
  "items": [
    {
      "sku": "string",              // SKU nội bộ brand (bắt buộc)
      "name": "string",
      "category": "string|null",
      "quantity": 1,                // > 0
      "unit_price": 0,              // >= 0
      "discount": 0                 // >= 0
    }
  ]
}
```
- **Side effect:** resolve OCC ID (nếu có identifier) → ghi canonical transaction (idempotent) → (GĐ sau: earn loyalty) trong **một transaction ACID**.
- Giao dịch không có identifier vẫn được ghi (ẩn danh), `occ_id = null`, để đối soát doanh thu; có thể stitch sau.

## 6. Event: `order_refunded`

- `message_id` = `"{brand_id}:{store_id}:{pos_transaction_id}:refund:{refund_id}"`.
- `properties`: `pos_transaction_id`, `refund_id`, `amount` (>=0), `reason`. (GĐ sau: reversal điểm.)

## 7. Consent purposes (taxonomy)

`marketing`, `personalization`, `analytics`, `cross_brand_sharing`, `ads_matching`, `service_message`. Mỗi purpose có `legal_basis` (GĐ sau, quản ở consent registry). Activation đối chiếu purpose tương ứng; thiếu/`denied` → loại record khỏi activation (KHÔNG ảnh hưởng ingestion/loyalty).

## 8. Error envelope (chuẩn cho mọi lỗi ingestion/API)

```jsonc
{
  "error": {
    "code": "SCHEMA_MISSING_REQUIRED_FIELD | SCHEMA_TYPE_MISMATCH | INVALID_IDENTIFIER | IDEMPOTENCY_CONFLICT | RATE_LIMIT_SOURCE_BURST | UNKNOWN_EVENT_TYPE | CONSENT_PURPOSE_NOT_GRANTED",
    "message": "human-readable (tiếng Việt)",
    "why": "nguyên nhân ngắn gọn",
    "fix": "cách sửa cụ thể",
    "field_path": "properties.items[0].quantity",
    "schema_version": 1,
    "docs_url": "https://.../tracking-plan-spec#order_completed",
    "correlation_id": "uuid",
    "retryable": false,
    "quarantine_id": "string|null"
  }
}
```
- **Lỗi validation đồng bộ → trả 4xx** kèm envelope (không nuốt im lặng). Không bao giờ trả `202 accepted` rồi vứt vào quarantine mà không có trạng thái truy vết.
- Event hợp lệ-schema nhưng lỗi downstream → quarantine + `quarantine_id` + hiển thị ở DLQ/Live Debugger + replay được.

## 9. Versioning policy

- `schema_version` theo SemVer ở mức spec.
- **Thêm field optional = non-breaking** (minor).
- **Đổi/bỏ field, đổi type, thêm required = breaking** (major) → cần migration guide + deprecation ≥ 90 ngày.
- Connector pin theo `schema_version`. Endpoint `/v1/compatibility/check` (GĐ sau) nhận payload mẫu → trả lỗi migration.

## 10. Phạm vi v1 (GĐ1 — vertical slice đầu)

Hỗ trợ: `identify`, `order_completed` (+ `order_refunded` schema-only). Identity deterministic theo `phone`/`email`/`loyalty_card`/`pos_member_id`. Các event hành vi (page/app/lead) và probabilistic identity: v2+.
