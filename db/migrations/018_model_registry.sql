-- Migration 018 — ML Model Registry + Model Card (do ai-service Python ghi khi train).
-- ml_model: mỗi lần train một model_type sinh 1 version; ≤1 active/model_type (partial unique).
-- model_card + model_feature_importance: nguồn cho UI Predictive Studio (metric + độ quan trọng
-- đặc trưng). Nếu ai-service chưa train, các bảng rỗng -> FE hiển thị "chưa có model" (fallback).

CREATE TABLE IF NOT EXISTS cdp.ml_model (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_type   text NOT NULL CHECK (model_type IN
                 ('churn','clv','propensity','next_purchase','affinity','lookalike')),
  version      integer NOT NULL,
  algorithm    text NOT NULL,
  metrics      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {auc:0.78, brier:0.19, mae:12.3, ...}
  feature_list jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_uri text NULL,
  sample_size  integer NULL,
  data_through timestamptz NULL,
  trained_at   timestamptz NOT NULL DEFAULT now(),
  is_active    boolean NOT NULL DEFAULT false,
  created_by   text NULL,
  UNIQUE (model_type, version)
);

-- ≤ 1 model active mỗi loại (serving đọc row active).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ml_model_active
  ON cdp.ml_model (model_type) WHERE is_active;

-- Model card gọn cho UI (giá trị mới nhất mỗi model_type; ai-service upsert khi promote active).
CREATE TABLE IF NOT EXISTS cdp.model_card (
  model_type   text PRIMARY KEY CHECK (model_type IN
                 ('churn','clv','propensity','next_purchase','affinity','lookalike')),
  model_version text NOT NULL,
  algorithm    text NOT NULL,
  metric_name  text NOT NULL,               -- 'auc' | 'mae' | 'spearman' ...
  metric_value numeric NOT NULL,
  sample_size  integer NULL,
  is_demo      boolean NOT NULL DEFAULT false, -- true khi metric là seed/demo-grade
  notes        text NULL,
  trained_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.model_feature_importance (
  model_type text NOT NULL,
  feature    text NOT NULL,
  weight     numeric NOT NULL,             -- độ quan trọng (SHAP mean|abs| hoặc gain)
  PRIMARY KEY (model_type, feature)
);
