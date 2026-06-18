-- Migration 009 — Customer Feature (point-in-time): nền cho AI phân tích hành vi + scoring.
-- RFM + hành vi cross-brand + loyalty + lifecycle + điểm heuristic v0. Phase C (ML) ghi đè
-- cùng schema với feature_version='ml-v1' (không phải viết lại). Recompute từ canonical_transaction.

CREATE TABLE IF NOT EXISTS cdp.customer_feature (
  occ_id              uuid PRIMARY KEY REFERENCES cdp.occ_identity (occ_id),
  recency_days        integer NULL,
  frequency           integer NOT NULL DEFAULT 0,
  monetary            bigint  NOT NULL DEFAULT 0,
  avg_basket          bigint  NOT NULL DEFAULT 0,
  distinct_brands     integer NOT NULL DEFAULT 0,
  distinct_categories integer NOT NULL DEFAULT 0,
  favorite_category   text    NULL,
  loyalty_available   bigint  NOT NULL DEFAULT 0,
  last_order_at       timestamptz NULL,
  lifecycle_stage     text NULL CHECK (lifecycle_stage IN
                        ('new','active','at_risk','vip','dormant','churned')),
  propensity_score    numeric(5,4) NULL,  -- 0..1 (heuristic v0)
  churn_risk          numeric(5,4) NULL,  -- 0..1 (heuristic v0)
  feature_version     text NOT NULL DEFAULT 'v0',
  computed_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cf_lifecycle ON cdp.customer_feature (lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_cf_recency   ON cdp.customer_feature (recency_days);
CREATE INDEX IF NOT EXISTS idx_cf_churn     ON cdp.customer_feature (churn_risk DESC);
