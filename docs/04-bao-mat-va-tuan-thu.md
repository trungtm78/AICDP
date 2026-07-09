# 4. Bảo mật & Tuân thủ

## 4.1. Xác thực (Authentication)

- **JWT HS256** cho user: `POST /v1/auth/login` (scrypt password) → JWT chứa `sub/role/name/exp`. `AuthGuard` verify chữ ký, chống **alg-confusion** (từ chối `alg:none`), lookup `app_user` theo `sub` → **role/status lấy từ DB hiện tại** (disable/đổi role hiệu lực ngay).
- **API key** (service-to-service, vd connector/POS): Bearer key **sha256** — DB chỉ lưu hash, **không lưu raw**; rawKey hiện đúng 1 lần khi tạo; revoke → 401.
- **Dummy-hash** chống user-enumeration (login sai user vs sai mật khẩu cùng thời gian/thông báo).
- Secret `CORE_API_JWT_SECRET` fail-fast ở production nếu yếu/thiếu.

## 4.2. Phân quyền (Authorization) — deny-by-default

- `RolesGuard`: route chỉ cho role trong `@Roles(...)`; **admin wildcard**; route quên `@Roles` → **chỉ admin qua** (chống authz-bypass do quên annotate). Chỉ `@Public` (health/login) bỏ qua auth.
- 8 persona: admin · data_steward · marketer · csr · analyst · compliance · executive · connector.

## 4.3. Rate-limit (chống burst) 3 tầng

- **IpRateLimitGuard** (pre-auth): shed flood trước khi tốn JWT/DB (opt-in `RATE_LIMIT_IP_BURST`).
- **RateLimitGuard** per-principal: key theo `principalId` ổn định (`user:<uuid>`/`key:<id>`), không theo tên.
- **Login/public theo IP**: chống brute force.
- Token-bucket in-memory (clock tiêm + eviction chống rò bộ nhớ); vượt → **429 + `Retry-After`**. `@SkipRateLimit` cho health; `TRUST_PROXY` (fail-fast) để `req.ip` đúng sau LB.
- *Giới hạn:* in-memory/process → đa-instance cần chuyển store sang **Redis** (next-step Phase B).

## 4.4. Consent & quyền riêng tư

- **Deny-by-default chokepoint:** trạng thái = bản ghi mới nhất theo `(occ, purpose)`; vắng mặt = denied. Chỉ **activation** (và journey-activation) gate consent; **ingestion & loyalty LUÔN nhận** (không mất giao dịch/điểm).
- **Append-only audit:** `consent_record` có trigger DB chặn UPDATE/DELETE → lịch sử bất biến.
- **Guardrail PII với LLM:** chỉ gửi dữ liệu phi-PII tới LLM cloud; policy `redact/block/allow` cấu hình trong AI Governance.
- Hướng **PDPD Việt Nam** · data residency (self-host 100%) · field-level masking · governed metrics.

## 4.5. Audit & toàn vẹn

- Bảng nhạy cảm **append-only** (consent, ai_config_audit): trigger DB chặn mutation → audit-grade phục vụ IPO.
- **Error envelope** đầy đủ `{code, message, why, fix, field_path, correlation_id, retryable}` — không nuốt data, mọi lỗi truy vết được qua `correlation_id`.
- Loyalty: double-entry + `idempotency_key` + trigger enforce `Σdelta=0` + cấm âm.

## 4.6. Hướng chứng nhận

SOC2 / ISO 27001 readiness; multi-tenant by design; RLS + field masking; lineage end-to-end; encryption tại rest/transit (triển khai ở tầng hạ tầng K8s/TLS/WAF khi lên production).
