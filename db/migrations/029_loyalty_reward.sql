-- Migration 029 — Reward catalog + voucher + redemption cross-brand. Đổi điểm CHUNG (OCC_POINT) lấy
-- reward -> tiêu ở BRAND bất kỳ (redeemable_at_brand NULL = mọi brand). Redeem = burn điểm atomic
-- (available -> redeemed) + phát voucher. Voucher FIXED cho tiêu MỘT PHẦN (remaining_value).

-- 1) Danh mục reward ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.reward_catalog_item (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  name                  text NOT NULL,
  type                  text NOT NULL CHECK (type IN ('VOUCHER','GIFT','PAY_WITH_POINTS','PARTNER')),
  cost_points           bigint NOT NULL CHECK (cost_points > 0),
  currency_id           uuid NOT NULL REFERENCES cdp.point_currency (id),  -- thường GROUP (cross-brand)
  redeemable_at_brand_id text NULL REFERENCES cdp.brand (brand_id),        -- NULL = mọi brand
  tier_min_level        int NULL,                                          -- yêu cầu hạng tối thiểu
  value_type            text NULL CHECK (value_type IN ('FIXED','PERCENT','PRODUCT')),  -- cho VOUCHER
  value                 numeric NULL,
  validity_days         int NOT NULL DEFAULT 90 CHECK (validity_days > 0), -- hạn voucher sau khi đổi
  stock                 int NULL,                                          -- NULL = vô hạn
  is_active             boolean NOT NULL DEFAULT true,
  valid_from            timestamptz NULL,
  valid_to              timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reward_active ON cdp.reward_catalog_item (is_active);
-- VOUCHER phải có value_type + value > 0 (chống phát voucher "rỗng" burn điểm mà không có giá trị).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_reward_voucher_value') THEN
    ALTER TABLE cdp.reward_catalog_item ADD CONSTRAINT ck_reward_voucher_value
      CHECK (type <> 'VOUCHER' OR (value_type IS NOT NULL AND value IS NOT NULL AND value > 0));
  END IF;
END $$;

-- 2) Voucher đã phát cho khách ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.voucher (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL UNIQUE,
  occ_id                uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  reward_item_id        uuid NOT NULL REFERENCES cdp.reward_catalog_item (id),
  redeem_txn            uuid NULL REFERENCES cdp.loyalty_txn (txn_id),      -- txn burn điểm khi đổi
  value_type            text NULL,
  value                 numeric NULL,
  remaining_value       numeric NULL,                                      -- FIXED: còn lại (partial)
  redeemable_at_brand_id text NULL,
  state                 text NOT NULL DEFAULT 'active' CHECK (state IN ('active','redeemed','expired','cancelled')),
  issued_at             timestamptz NOT NULL DEFAULT now(),
  expire_at             timestamptz NULL,
  redeemed_at           timestamptz NULL
);
CREATE INDEX IF NOT EXISTS idx_voucher_occ ON cdp.voucher (occ_id, state);
CREATE INDEX IF NOT EXISTS idx_voucher_expire ON cdp.voucher (expire_at) WHERE state = 'active';

-- 3) Lịch sử sử dụng voucher (partial redemption) — append-only ---------------------------------
CREATE TABLE IF NOT EXISTS cdp.voucher_redemption (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  voucher_id  uuid NOT NULL REFERENCES cdp.voucher (id),
  brand_id    text NULL,
  amount      numeric NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  redeemed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voucher_redemption ON cdp.voucher_redemption (voucher_id, id);

-- 4) Seed vài reward mẫu (đổi điểm CHUNG OCC_POINT; cross-brand) --------------------------------
INSERT INTO cdp.reward_catalog_item (code, name, type, cost_points, currency_id, value_type, value, validity_days, redeemable_at_brand_id, tier_min_level)
SELECT * FROM (
  SELECT 'VOUCHER_50K', 'Voucher 50.000đ (mọi thương hiệu)', 'VOUCHER', 500::bigint, c.id, 'FIXED', 50000, 90, NULL::text, NULL::int FROM cdp.point_currency c WHERE c.code='OCC_POINT'
  UNION ALL
  SELECT 'VOUCHER_10PCT', 'Giảm 10% (Gold trở lên)', 'VOUCHER', 300::bigint, c.id, 'PERCENT', 10, 60, NULL::text, 2 FROM cdp.point_currency c WHERE c.code='OCC_POINT'
) v
ON CONFLICT (code) DO NOTHING;
