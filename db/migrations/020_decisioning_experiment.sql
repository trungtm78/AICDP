-- Migration 020 — AI Decisioning (offer catalog) + Experimentation (A/B holdout + uplift).
-- offer_catalog: các ưu đãi để arbitration chọn (expectedValue = propensity × base_value).
-- experiment + experiment_assignment: gán biến thể deterministic, đo uplift treatment vs holdout.

CREATE TABLE IF NOT EXISTS cdp.offer_catalog (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('loyalty_bonus','discount','content','activation')),
  purpose     text NULL,                       -- consent purpose nếu cần kênh marketing
  channel     text NULL,
  base_value  bigint NOT NULL DEFAULT 0,       -- giá trị kỳ vọng nếu khách nhận (VND/điểm quy đổi)
  eligibility text NULL,                       -- lifecycle gợi ý (vd 'at_risk')
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.experiment (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'ab' CHECK (kind IN ('ab','holdout')),
  holdout_pct integer NOT NULL DEFAULT 20 CHECK (holdout_pct BETWEEN 0 AND 100),
  status      text NOT NULL DEFAULT 'running' CHECK (status IN ('running','stopped')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.experiment_assignment (
  experiment_id uuid NOT NULL REFERENCES cdp.experiment (id) ON DELETE CASCADE,
  occ_id        uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  variant       text NOT NULL CHECK (variant IN ('treatment','holdout')),
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, occ_id)
);
CREATE INDEX IF NOT EXISTS idx_exp_assign_exp ON cdp.experiment_assignment (experiment_id);
