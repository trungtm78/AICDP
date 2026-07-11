-- Migration 025 — Loyalty coalition foundation: pháp nhân (company) + đa point-currency + tỷ giá
-- quy đổi + tiến hoá ledger (currency_id) + trigger cân bằng PER (txn, currency). Additive + idempotent.
-- Giữ nguyên kernel double-entry hiện có; điểm cũ backfill về GROUP currency (tương thích ngược).

-- 1) Pháp nhân (company / legal entity) trên brand ---------------------------------
CREATE TABLE IF NOT EXISTS cdp.company (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  tax_code   text NULL,
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO cdp.company (code, name) VALUES
  ('occ_fnb',   'OCC F&B'),
  ('occ_hotel', 'OCC Hospitality')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE cdp.brand ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES cdp.company (id);
-- Map brand -> company (idempotent; chỉ set khi chưa gán). Mảng khách sạn vs F&B tách pháp nhân.
UPDATE cdp.brand SET company_id = (SELECT id FROM cdp.company WHERE code='occ_fnb')
  WHERE company_id IS NULL AND brand_id IN ('givral','kem_trang_tien','fuji');
UPDATE cdp.brand SET company_id = (SELECT id FROM cdp.company WHERE code='occ_hotel')
  WHERE company_id IS NULL AND brand_id IN ('sunrise_nha_trang','starcity_nha_trang','dusit_hanoi');

-- 2) Loại điểm / ví (point currency): 1 GROUP (điểm chung tập đoàn) + mỗi brand 1 BRAND ----------
CREATE TABLE IF NOT EXISTS cdp.point_currency (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('GROUP','BRAND','STORED_VALUE')),
  brand_id   text NULL REFERENCES cdp.brand (brand_id),
  company_id uuid NULL REFERENCES cdp.company (id),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Điểm CHUNG tập đoàn (coalition currency) — nơi các điểm brand quy đổi về để tiêu chéo.
INSERT INTO cdp.point_currency (code, name, kind) VALUES ('OCC_POINT','OCC Point (Tập đoàn)','GROUP')
ON CONFLICT (code) DO NOTHING;
-- Điểm riêng mỗi brand.
INSERT INTO cdp.point_currency (code, name, kind, brand_id, company_id)
SELECT upper(b.brand_id) || '_PT', b.name || ' Point', 'BRAND', b.brand_id, b.company_id
  FROM cdp.brand b
ON CONFLICT (code) DO NOTHING;

-- 3) Tỷ giá quy đổi (brand <-> group): 1 điểm 'from' = rate điểm 'to' ---------------------------
CREATE TABLE IF NOT EXISTS cdp.point_conversion (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency_id uuid NOT NULL REFERENCES cdp.point_currency (id),
  to_currency_id   uuid NOT NULL REFERENCES cdp.point_currency (id),
  rate             numeric NOT NULL CHECK (rate > 0),
  valid_from       timestamptz NOT NULL DEFAULT now(),
  valid_to         timestamptz NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_conv_diff CHECK (from_currency_id <> to_currency_id)
);
-- Chống nhiều tỷ giá "mở" (valid_to NULL) cùng cặp -> convert phi-tất-định (mint/hụt tuỳ dữ liệu).
CREATE UNIQUE INDEX IF NOT EXISTS uq_conv_open
  ON cdp.point_conversion (from_currency_id, to_currency_id) WHERE valid_to IS NULL;
-- Seed tỷ giá brand -> group = 1:1 (mặc định; admin chỉnh sau).
INSERT INTO cdp.point_conversion (from_currency_id, to_currency_id, rate)
SELECT bc.id, gc.id, 1
  FROM cdp.point_currency bc
  CROSS JOIN (SELECT id FROM cdp.point_currency WHERE code='OCC_POINT') gc
 WHERE bc.kind='BRAND'
   AND NOT EXISTS (SELECT 1 FROM cdp.point_conversion pc WHERE pc.from_currency_id=bc.id AND pc.to_currency_id=gc.id);

-- 4) Tiến hoá ledger: currency_id trên entry + cột scope trên txn -------------------------------
ALTER TABLE cdp.loyalty_entry ADD COLUMN IF NOT EXISTS currency_id uuid REFERENCES cdp.point_currency (id);
ALTER TABLE cdp.loyalty_txn
  ADD COLUMN IF NOT EXISTS brand_id       text NULL,
  ADD COLUMN IF NOT EXISTS store_id       text NULL,
  ADD COLUMN IF NOT EXISTS source         text NULL,   -- kênh phát sinh (pos|web|app|...)
  ADD COLUMN IF NOT EXISTS ref_message_id text NULL,   -- tham chiếu canonical_transaction
  ADD COLUMN IF NOT EXISTS correlation_id text NULL;
-- Backfill entry cũ -> group currency (tương thích ngược: kernel cũ = điểm chung).
UPDATE cdp.loyalty_entry SET currency_id = (SELECT id FROM cdp.point_currency WHERE code='OCC_POINT')
  WHERE currency_id IS NULL;
-- Bắt buộc mọi entry có currency_id (chống bút toán 'không currency' -> lệch balance/liability âm thầm).
ALTER TABLE cdp.loyalty_entry ALTER COLUMN currency_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_loyalty_entry_acc_cur ON cdp.loyalty_entry (account, currency_id);

-- 5) Trigger cân bằng PER (txn, currency) — mỗi loại điểm cân riêng (hỗ trợ convert đa-currency) --
CREATE OR REPLACE FUNCTION cdp.assert_loyalty_balanced() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cdp.loyalty_entry WHERE txn_id = NEW.txn_id
    GROUP BY txn_id, currency_id HAVING sum(delta) <> 0
  ) THEN
    RAISE EXCEPTION 'loyalty txn % không cân theo currency: tổng delta != 0', NEW.txn_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
