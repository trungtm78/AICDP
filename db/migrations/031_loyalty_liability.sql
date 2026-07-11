-- Migration 031 — Liability (IFRS15/ASC606) + inter-company settlement. Điểm outstanding × unit value
-- × (1-breakage) = deferred revenue (nghĩa vụ điểm), CẮT THEO pháp nhân phát hành (issuing_company của
-- loyalty_lot). Settlement credit-in-arrears: điểm phát ở cty A tiêu ở cty B -> A bù cho B cuối kỳ.

-- 1) Đơn giá điểm + tỷ lệ breakage (per currency, tùy chọn per issuing company) -----------------
CREATE TABLE IF NOT EXISTS cdp.point_price (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_id        uuid NOT NULL REFERENCES cdp.point_currency (id),
  issuing_company_id uuid NULL REFERENCES cdp.company (id),      -- NULL = áp mọi pháp nhân
  price_per_point    numeric NOT NULL CHECK (price_per_point >= 0),  -- giá trị tiền / 1 điểm (vd 1000đ)
  breakage_rate      numeric NOT NULL DEFAULT 0 CHECK (breakage_rate >= 0 AND breakage_rate < 1),
  valid_from         timestamptz NOT NULL DEFAULT now(),
  valid_to           timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_point_price_open
  ON cdp.point_price (currency_id, COALESCE(issuing_company_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE valid_to IS NULL;
-- Seed: điểm CHUNG OCC_POINT = 1000đ/điểm, breakage 20% (giả định kế toán mặc định).
INSERT INTO cdp.point_price (currency_id, price_per_point, breakage_rate)
SELECT id, 1000, 0.20 FROM cdp.point_currency WHERE code='OCC_POINT'
ON CONFLICT DO NOTHING;

-- 2) Snapshot nghĩa vụ điểm (audit-grade, append-only) ------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.liability_snapshot (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  as_of              timestamptz NOT NULL DEFAULT now(),
  company_id         uuid NULL REFERENCES cdp.company (id),      -- NULL = điểm chưa gắn pháp nhân
  currency_id        uuid NOT NULL REFERENCES cdp.point_currency (id),
  outstanding_points bigint NOT NULL,
  unit_value         numeric NOT NULL,
  breakage_rate      numeric NOT NULL,
  gross_liability    numeric NOT NULL,   -- outstanding × unit_value
  deferred_revenue   numeric NOT NULL,   -- gross × (1 - breakage): nghĩa vụ dự kiến phải thực hiện
  breakage_revenue   numeric NOT NULL,   -- gross × breakage: doanh thu vỡ dự kiến
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_liability_asof ON cdp.liability_snapshot (as_of DESC, company_id, currency_id);

CREATE OR REPLACE FUNCTION cdp.prevent_liability_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'cdp.liability_snapshot là append-only: không được %', TG_OP; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_liability_immutable ON cdp.liability_snapshot;
CREATE TRIGGER trg_liability_immutable BEFORE UPDATE OR DELETE ON cdp.liability_snapshot
  FOR EACH ROW EXECUTE FUNCTION cdp.prevent_liability_mutation();

-- 3) Nghĩa vụ settlement inter-company (credit-in-arrears) --------------------------------------
CREATE TABLE IF NOT EXISTS cdp.settlement_txn (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period              text NOT NULL,                             -- 'YYYY-MM'
  issuing_company_id  uuid NULL REFERENCES cdp.company (id),     -- cty phát hành điểm (được bù)
  redeeming_company_id uuid NULL REFERENCES cdp.company (id),    -- cty nơi điểm được tiêu (đòi bù)
  currency_id         uuid NOT NULL REFERENCES cdp.point_currency (id),
  points              bigint NOT NULL,
  unit_value          numeric NOT NULL,
  amount              numeric NOT NULL,                          -- points × unit_value (A bù cho B)
  ref_txn             uuid NULL REFERENCES cdp.loyalty_txn (txn_id),
  idempotency_key     text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued','netted','settled')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_settlement_period ON cdp.settlement_txn (period, issuing_company_id, redeeming_company_id);
