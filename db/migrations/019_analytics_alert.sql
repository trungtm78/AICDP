-- Migration 019 — Analytics Alert (phát hiện bất thường: z-score/EWMA trên chuỗi thời gian).
-- Lưu lịch sử cảnh báo + trạng thái acknowledged. Dedupe theo (metric, period).

CREATE TABLE IF NOT EXISTS cdp.analytics_alert (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  metric       text NOT NULL,                 -- 'revenue_weekly' | 'orders_weekly' | ...
  period       text NOT NULL,                 -- nhãn kỳ (vd '2026-W27' hoặc ngày bắt đầu tuần)
  value        numeric NOT NULL,
  expected     numeric NOT NULL,              -- kỳ vọng (mean rolling)
  zscore       numeric NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('info','warning','critical')),
  direction    text NOT NULL CHECK (direction IN ('up','down')),
  acknowledged boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (metric, period)
);

CREATE INDEX IF NOT EXISTS idx_alert_created ON cdp.analytics_alert (created_at DESC);
