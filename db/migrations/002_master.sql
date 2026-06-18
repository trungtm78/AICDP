-- Migration 002 — master data đa thương hiệu (KHÔNG hardcode ở frontend; mọi danh mục từ DB).
-- brand · store · product_category · product_master · sku_mapping (crosswalk SKU brand -> SKU chuẩn OCC).

CREATE TABLE IF NOT EXISTS cdp.brand (
  brand_id     text PRIMARY KEY,            -- slug: givral, kem_trang_tien, ...
  name         text NOT NULL,
  industry     text NULL,                   -- bakery | ice_cream | fmcg
  brand_accent text NULL,                   -- màu brand-kit (hex token)
  status       text NOT NULL DEFAULT 'active',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.store (
  store_id   text PRIMARY KEY,
  brand_id   text NOT NULL REFERENCES cdp.brand (brand_id),
  name       text NOT NULL,
  region     text NULL,                     -- mien_bac | mien_trung | mien_nam
  city       text NULL,
  address    text NULL,
  status     text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_store_brand ON cdp.store (brand_id);

CREATE TABLE IF NOT EXISTS cdp.product_category (
  category_id text PRIMARY KEY,             -- slug chuẩn OCC
  name        text NOT NULL,
  parent_id   text NULL REFERENCES cdp.product_category (category_id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.product_master (
  product_master_id text PRIMARY KEY,       -- SKU chuẩn OCC
  name              text NOT NULL,
  category_id       text NULL REFERENCES cdp.product_category (category_id),
  unit              text NULL,
  status            text NOT NULL DEFAULT 'active',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_category ON cdp.product_master (category_id);

-- Crosswalk: SKU nội bộ từng brand -> SKU chuẩn OCC (v1: một mapping active / (brand, pos_sku))
CREATE TABLE IF NOT EXISTS cdp.sku_mapping (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id          text NOT NULL REFERENCES cdp.brand (brand_id),
  pos_sku           text NOT NULL,
  product_master_id text NOT NULL REFERENCES cdp.product_master (product_master_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sku UNIQUE (brand_id, pos_sku)
);

-- Seed 5 thương hiệu OCC làm REFERENCE DATA trong DB (không phải hardcode frontend).
INSERT INTO cdp.brand (brand_id, name, industry, brand_accent) VALUES
  ('givral',           'Givral',            'bakery',    '#C8102E'),
  ('kem_trang_tien',   'Kem Tràng Tiền',    'ice_cream', '#0EA5A4'),
  ('hai_ha_kotobuki',  'Hải Hà Kotobuki',   'bakery',    '#E4572E'),
  ('fuji',             'Fuji Foods',        'fmcg',      '#2563EB'),
  ('origato',          'Origato',           'bakery',    '#7C3AED')
ON CONFLICT (brand_id) DO NOTHING;
