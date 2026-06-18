-- Migration 006 — Auth/RBAC: API key + role. Deny-by-default ở tầng HTTP (mọi /v1 cần key
-- hợp lệ trừ /v1/health). Mỗi route yêu cầu role cụ thể (RBAC theo persona). Key lưu dạng
-- băm sha256 hex (không lưu key thô). LƯU Ý: đây là cơ chế nền GĐ1; production cần thêm
-- JWT cho user + rotation + rate-limit (xem memory occ-cdp-auth-gap).

CREATE TABLE IF NOT EXISTS cdp.api_key (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name       text NOT NULL,
  role       text NOT NULL CHECK (role IN
               ('admin','data_steward','marketer','csr','analyst','compliance','executive','connector')),
  key_hash   text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- KHÔNG seed key ở đây: tránh đưa credential admin vào mọi môi trường chạy migration.
-- Key được cấp out-of-band: test tự seed (test-helpers), dev chạy thủ công db/seeds/dev_admin_key.sql,
-- production cấp qua công cụ vận hành (xem memory occ-cdp-auth-gap).
