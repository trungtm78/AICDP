-- Giỏ hàng (cart) — hỗ trợ phân tích giỏ đang mở / BỎ QUÊN để thúc đẩy hoàn tất đơn
-- (abandoned cart recovery), không bỏ lỡ cơ hội bán. Nguồn: web/app/POS gửi cart_updated.
CREATE TABLE IF NOT EXISTS cdp.cart (
  cart_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occ_id      uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  brand_id    text NOT NULL,
  store_id    text NULL,
  channel     text NULL,                    -- web | app | pos
  status      text NOT NULL DEFAULT 'active' -- active (đang mở) | abandoned (bỏ quên) | converted
                CHECK (status IN ('active', 'abandoned', 'converted')),
  items       jsonb NOT NULL DEFAULT '[]',
  value       bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cart_occ ON cdp.cart (occ_id);
CREATE INDEX IF NOT EXISTS idx_cart_status ON cdp.cart (status);
