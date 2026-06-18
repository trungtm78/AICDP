-- Migration 008 — Người dùng đăng nhập (admin-console). Login -> JWT mang role.
-- API key (006) vẫn dùng cho service-to-service (POS/connector). app_user cho người thật.
-- KHÔNG seed credential ở đây (bảo mật); dev tạo user qua scripts/seed-dev-user.ts.

CREATE TABLE IF NOT EXISTS cdp.app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN
                  ('admin','data_steward','marketer','csr','analyst','compliance','executive','connector')),
  name          text NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
