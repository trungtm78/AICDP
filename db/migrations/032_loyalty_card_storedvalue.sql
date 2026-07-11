-- Migration 032 — Thẻ thành viên số (card/QR) + ví stored-value (nạp tiền / pay-with-points). Thẻ để
-- resolve khách tại POS. Stored-value dùng chính sổ cái double-entry (currency kind STORED_VALUE, lô
-- expire NULL — không hết hạn). Authorization tại quầy = reserve->capture (kernel đã có).

-- gen_random_bytes (qr_token) cần pgcrypto — khai báo tường minh để provision sạch từ migration chạy được.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Thẻ thành viên (số thẻ + QR token) --------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.member_card (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occ_id     uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  card_no    text NOT NULL UNIQUE,
  qr_token   text NOT NULL UNIQUE,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','lost')),
  issued_at  timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_card_occ ON cdp.member_card (occ_id);
-- 1 thẻ ACTIVE / khách (chống race tạo 2 thẻ).
CREATE UNIQUE INDEX IF NOT EXISTS uq_member_card_active ON cdp.member_card (occ_id) WHERE status = 'active';

-- 2) Ví stored-value: 1 currency kind STORED_VALUE cho toàn coalition (tiền nạp, đơn vị = VND) -----
INSERT INTO cdp.point_currency (code, name, kind) VALUES ('OCC_CASH','OCC Stored Value (VND)','STORED_VALUE')
ON CONFLICT (code) DO NOTHING;
-- KHÔNG seed expiration_policy cho OCC_CASH -> lô stored-value có expire_at NULL (không đáo hạn).
-- KHÔNG seed point_price -> stored-value không tính vào liability điểm (là tiền, không phải nghĩa vụ điểm).
