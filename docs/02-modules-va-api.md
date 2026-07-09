# 2. Modules & API

Base URL: `core-api` tại `http://127.0.0.1:8071`, mọi endpoint prefix `/v1`. Auth: `Authorization: Bearer <JWT|API key>`. RBAC deny-by-default (route không khai `@Roles` → chỉ admin qua; `@Public` chỉ dùng cho health/login).

## 2.1. 11 bounded context

| # | Context | Vai trò | Bất biến chính |
|---|---------|---------|----------------|
| 1 | **Identity** | Hợp nhất OCC ID xuyên brand | UNIQUE(type, value_normalized) + advisory lock, merge non-destructive |
| 2 | **Master Data** | brand/store/product/SKU crosswalk | sku_mapping → product_master → category |
| 3 | **Ingestion** | Nhận đơn POS/connector | idempotent `{brand}:{store}:{pos_txn}` |
| 4 | **Loyalty** | Sổ điểm double-entry | Σdelta=0, balance=projection, cấm âm, state machine |
| 5 | **Consent** | Đồng ý deny-by-default | append-only, latest-wins, chỉ activation gate |
| 6 | **Activation** | Đẩy audience (chokepoint consent) | total = allowed + suppressed |
| 7 | **Segment** | Lọc occId theo hành vi + AI | count = |occIds| |
| 8 | **Analytics** | KPI + insights | fallback PG khi CH lỗi |
| 9 | **AI cross-sell** | Recommendation + generative | xem [tài liệu AI](./03-ai.md) |
| 10 | **Journey** | Orchestration segment → action | idempotency `journey:{runId}:{occId}` |
| 11 | **Auth/Platform** | JWT · RBAC · user & API key | role đọc DB mỗi request |

## 2.2. Danh mục endpoint

### Health / Auth
| Method · Path | RBAC | Ghi chú |
|---|---|---|
| `GET /v1/health` | Public | `{status:"ok"}` (SkipRateLimit) |
| `POST /v1/auth/login` | Public | body `{username,password}` → `{token,role,name}` |
| `GET/POST /v1/auth/users` · `POST /v1/auth/users/:id/status` | admin | quản lý user |
| `GET/POST /v1/auth/api-keys` · `POST /v1/auth/api-keys/:id/revoke` | admin | rawKey hiện 1 lần |

### Ingestion / Master / Customer
| Method · Path | RBAC | Ghi chú |
|---|---|---|
| `POST /v1/ingest` | connector | union `order_completed` \| `identify` → 202 |
| `GET /v1/brands` · `GET/POST /v1/stores` · `GET/POST /v1/products` · `POST /v1/categories` · `POST /v1/sku-mappings` | read: nhiều role · create: data_steward | master data |
| `GET /v1/customers/lookup?type=&value=` | csr/analyst/marketer/data_steward | Customer 360; 404 `CUSTOMER_NOT_FOUND` |

### Loyalty
| Method · Path | RBAC |
|---|---|
| `POST /v1/loyalty/earn` · `/reserve` · `/capture` · `/release` | csr |
| `GET /v1/loyalty/balance?occId=` | csr/analyst |

### Consent / Activation / Segment / Journey
| Method · Path | RBAC |
|---|---|
| `POST /v1/consent` | compliance/csr |
| `GET /v1/consent?occId=` · `GET /v1/consent/check?occId=&purpose=` | compliance/csr/marketer/analyst |
| `POST /v1/activation` · `GET /v1/activation/:runId` | marketer |
| `POST /v1/segments/preview` | marketer/analyst |
| `GET/POST /v1/journeys` · `POST /v1/journeys/:id/run` | marketer |

### Analytics / AI (xem [tài liệu AI](./03-ai.md) cho chi tiết)
| Method · Path | RBAC |
|---|---|
| `GET /v1/analytics/overview` · `/revenue-by-brand` · `/forecast` · `/insights` | executive/analyst/marketer |
| `GET /v1/ai/recommendations` · `/recommendations/v2` · `POST /v1/ai/nba` | marketer/analyst |
| `GET/POST /v1/ai/config` · `/config/audit` · `/config/usage` | admin |
| `GET /v1/ai/features/:occId` · `POST /v1/ai/features/recompute` | read: nhiều role · recompute: admin/data_steward |
| `POST /v1/ai/assistant/{ask,segment,content,explain}` | marketer/analyst |

## 2.3. RBAC — 8 role

`admin` (wildcard) · `data_steward` (master data) · `marketer` (activation/journey/segment/AI/analytics) · `csr` (loyalty/consent/lookup) · `analyst` (analytics/segment/AI/lookup) · `compliance` (consent) · `executive` (analytics read-only) · `connector` (ingestion service-to-service).

**Deny-by-default:** `RolesGuard` chặn mọi role không nằm trong `@Roles`; route quên `@Roles` → chỉ admin qua. Role/status đọc lại từ DB mỗi request → disable user / đổi role có hiệu lực ngay.

## 2.4. Error envelope (chống nuốt data)

Mọi lỗi trả cấu trúc thống nhất — không bao giờ 500 trần:

```json
{
  "error": {
    "code": "SCHEMA_MISSING_REQUIRED_FIELD",
    "message": "Thiếu field bắt buộc: points",
    "why": "Required",
    "fix": "Thêm field \"points\" vào payload theo tracking-plan-spec.",
    "field_path": "points",
    "schema_version": 1,
    "docs_url": "https://docs.occ-cdp.internal/tracking-plan-spec#loyalty_earn",
    "correlation_id": "<uuid>",
    "retryable": false,
    "quarantine_id": null
  }
}
```

Mã lỗi tiêu biểu: `SCHEMA_MISSING_REQUIRED_FIELD`, `SCHEMA_TYPE_MISMATCH`, `INVALID_IDENTIFIER`, `UNKNOWN_EVENT_TYPE`, `CUSTOMER_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`, `INSUFFICIENT_BALANCE`, `RESERVATION_INVALID_STATE`, `UNAUTHENTICATED`(401), `FORBIDDEN`(403), `RATE_LIMIT_*`(429), `LLM_DISABLED`, `LLM_NOT_CONFIGURED`.
