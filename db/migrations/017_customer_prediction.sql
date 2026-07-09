-- Migration 017 — Customer Prediction (kho điểm dự đoán ML).
-- Tách khỏi customer_feature để GIỮ PROVENANCE: điểm do ai-service (ML) ghi async, kèm
-- score_source ('ml'|'heuristic') + model_version. customer_feature vẫn do core-api sở hữu
-- ACID; bảng này là snapshot mới nhất per occ (upsert theo occ_id). Honest-labeling ở tầng DB.

CREATE TABLE IF NOT EXISTS cdp.customer_prediction (
  occ_id              uuid PRIMARY KEY REFERENCES cdp.occ_identity (occ_id),
  predicted_clv       bigint       NULL,          -- CLV 12 tháng (VND)
  predicted_purchases numeric(8,2) NULL,          -- E[số đơn tương lai] (BG/NBD)
  churn_prob          numeric(5,4) NULL,          -- 0..1
  propensity          numeric(5,4) NULL,          -- 0..1 (mua trong horizon N ngày)
  propensity_category text         NULL,          -- category có khả năng mua nhất (tùy chọn)
  next_purchase_at    timestamptz  NULL,          -- ngày mua kế dự đoán
  next_interval_days  integer      NULL,          -- số ngày tới đơn kế
  score_source        text NOT NULL DEFAULT 'heuristic'
                        CHECK (score_source IN ('ml','heuristic')),
  model_versions      jsonb NOT NULL DEFAULT '{}'::jsonb, -- {churn:"churn-v3", clv:"clv-v2", ...}
  explain             jsonb NOT NULL DEFAULT '{}'::jsonb, -- {churn:[reasons], propensity:[reasons]}
  computed_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_churn      ON cdp.customer_prediction (churn_prob DESC);
CREATE INDEX IF NOT EXISTS idx_cp_propensity ON cdp.customer_prediction (propensity DESC);
CREATE INDEX IF NOT EXISTS idx_cp_clv        ON cdp.customer_prediction (predicted_clv DESC);
CREATE INDEX IF NOT EXISTS idx_cp_source     ON cdp.customer_prediction (score_source);
