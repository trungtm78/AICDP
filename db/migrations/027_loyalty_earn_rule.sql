-- Migration 027 — Earn rule engine (no-code, append-only + audit) + auto-earn từ canonical_transaction.
-- Quy tắc tích điểm cấu hình bằng DATA (không sửa code): rate theo tiền + multiplier, scope theo
-- brand/kênh, điều kiện jsonb, phân biệt qualifying (tính hạng) vs non-qualifying. Auto-earn CHẠY
-- NGOÀI ingest (scheduler quét canonical_transaction chưa tích) — đúng CLAUDE.md (earn không ở ingest).

-- 1) Quy tắc tích điểm ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.earn_rule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_key      text NOT NULL,                 -- định danh nghiệp vụ (vd 'base', 'givral_weekend')
  version       int  NOT NULL DEFAULT 1,
  name          text NOT NULL,
  brand_id      text NULL REFERENCES cdp.brand (brand_id),  -- NULL = mọi brand
  channel       text NULL,                     -- NULL = mọi kênh (source: pos|web|app...)
  currency_id   uuid NOT NULL REFERENCES cdp.point_currency (id),
  rate_per_unit numeric NOT NULL CHECK (rate_per_unit >= 0),  -- điểm / 1 đơn vị tiền (vd 0.001 = 1đ/1000)
  multiplier    numeric NOT NULL DEFAULT 1 CHECK (multiplier >= 0),
  min_amount    bigint  NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  qualifying    boolean NOT NULL DEFAULT true, -- true = điểm tính hạng (qualifying)
  priority      int     NOT NULL DEFAULT 100,  -- lớn hơn = ưu tiên hơn khi nhiều rule khớp
  conditions    jsonb   NOT NULL DEFAULT '{}', -- điều kiện mở rộng (day_of_week[], payment_method...)
  valid_from    timestamptz NULL,              -- NULL = luôn hiệu lực (rule nền); có giá trị = promo window
  valid_to      timestamptz NULL,
  is_active     boolean NOT NULL DEFAULT true,
  updated_by    text NOT NULL DEFAULT 'system',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_key, version)
);
CREATE INDEX IF NOT EXISTS idx_earn_rule_match ON cdp.earn_rule (is_active, brand_id, channel, priority DESC);
-- Idempotent: bảng đã tồn tại (lần migrate trước) có thể còn NOT NULL/DEFAULT cũ trên valid_from.
ALTER TABLE cdp.earn_rule ALTER COLUMN valid_from DROP NOT NULL;
ALTER TABLE cdp.earn_rule ALTER COLUMN valid_from DROP DEFAULT;

-- 2) Audit append-only (audit-grade, hướng IPO) — chặn UPDATE/DELETE ------------------------------
CREATE TABLE IF NOT EXISTS cdp.earn_rule_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rule_key   text NOT NULL,
  old_value  jsonb NULL,
  new_value  jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_earn_rule_audit_key ON cdp.earn_rule_audit (rule_key, changed_at DESC, id DESC);

CREATE OR REPLACE FUNCTION cdp.prevent_earn_rule_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cdp.earn_rule_audit là append-only: không được %', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_earn_rule_audit_immutable ON cdp.earn_rule_audit;
CREATE TRIGGER trg_earn_rule_audit_immutable
  BEFORE UPDATE OR DELETE ON cdp.earn_rule_audit
  FOR EACH ROW EXECUTE FUNCTION cdp.prevent_earn_rule_audit_mutation();

-- 2b) earn_rule cũng APPEND-ONLY ở tầng DB: cấm DELETE; UPDATE chỉ được đổi is_active (vô hiệu hoá
-- version cũ khi tạo version mới) — MỌI cột nội dung (rate/multiplier/scope/window...) bất biến.
-- Chống sửa lén tỷ giá tích điểm không để lại dấu vết (audit-grade). TRUNCATE (test) bỏ qua trigger row.
CREATE OR REPLACE FUNCTION cdp.guard_earn_rule_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'cdp.earn_rule là append-only: không được DELETE (rule_key=%, version=%)', OLD.rule_key, OLD.version;
  END IF;
  IF NEW.rule_key IS DISTINCT FROM OLD.rule_key OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.name IS DISTINCT FROM OLD.name OR NEW.brand_id IS DISTINCT FROM OLD.brand_id
     OR NEW.channel IS DISTINCT FROM OLD.channel OR NEW.currency_id IS DISTINCT FROM OLD.currency_id
     OR NEW.rate_per_unit IS DISTINCT FROM OLD.rate_per_unit OR NEW.multiplier IS DISTINCT FROM OLD.multiplier
     OR NEW.min_amount IS DISTINCT FROM OLD.min_amount OR NEW.qualifying IS DISTINCT FROM OLD.qualifying
     OR NEW.priority IS DISTINCT FROM OLD.priority OR NEW.conditions IS DISTINCT FROM OLD.conditions
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from OR NEW.valid_to IS DISTINCT FROM OLD.valid_to THEN
    RAISE EXCEPTION 'cdp.earn_rule append-only: chỉ được đổi is_active, không sửa nội dung version (tạo version mới thay thế)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_earn_rule_guard ON cdp.earn_rule;
CREATE TRIGGER trg_earn_rule_guard
  BEFORE UPDATE OR DELETE ON cdp.earn_rule
  FOR EACH ROW EXECUTE FUNCTION cdp.guard_earn_rule_mutation();

-- 3) qualifying trên loyalty_txn (để L4 tier tính Σ điểm qualifying theo kỳ) ----------------------
ALTER TABLE cdp.loyalty_txn ADD COLUMN IF NOT EXISTS qualifying boolean NOT NULL DEFAULT true;

-- 3b) Cờ đã auto-earn trên canonical_transaction (scan chống rescan/starvation; set kể cả khi
-- không rule nào khớp -> không quét lại vô hạn). Auto-earn CHẠY NGOÀI ingest (scheduler).
ALTER TABLE cdp.canonical_transaction ADD COLUMN IF NOT EXISTS loyalty_earned boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_txn_unearned ON cdp.canonical_transaction (received_at)
  WHERE loyalty_earned = false AND occ_id IS NOT NULL;

-- 4) Seed base rule: mọi brand/kênh, tích vào điểm CHUNG, 1 điểm / 1000 VND, qualifying -----------
-- valid_from NULL = luôn hiệu lực (áp cả giao dịch cũ khi backfill auto-earn).
INSERT INTO cdp.earn_rule (rule_key, version, name, currency_id, rate_per_unit, priority, valid_from)
SELECT 'base', 1, 'Tích điểm cơ bản (1 điểm / 1000đ)', c.id, 0.001, 0, NULL
  FROM cdp.point_currency c WHERE c.code = 'OCC_POINT'
ON CONFLICT (rule_key, version) DO NOTHING;
