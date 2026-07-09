-- Quên mật khẩu: token đặt lại (lưu BĂM sha256, hết hạn 30', dùng 1 lần).
-- Kênh giao token demo-grade (hiện trên màn khi CORE_API_DEMO_RESET=1) — luồng token vẫn chuẩn an toàn.
CREATE TABLE IF NOT EXISTS cdp.password_reset (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES cdp.app_user(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,          -- sha256(token) — không lưu token thô
  expires_at timestamptz NOT NULL,
  used_at    timestamptz NULL,              -- dùng 1 lần
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pwreset_user ON cdp.password_reset(user_id);
