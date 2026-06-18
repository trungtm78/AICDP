-- Migration 007 — Journeys: orchestration. Một journey = segment (đối tượng) + action.
-- Run journey: resolve segment -> thực thi action (activation gate-consent / loyalty bonus),
-- ghi journey_run để audit. Tái dùng segment/activation/loyalty đã có (đóng vòng pipeline).

CREATE TABLE IF NOT EXISTS cdp.journey (
  journey_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  segment_criteria jsonb NOT NULL DEFAULT '{}',
  action           jsonb NOT NULL,   -- {type:'activation',purpose,channel,destination} | {type:'loyalty_bonus',points}
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.journey_run (
  run_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id    uuid NOT NULL REFERENCES cdp.journey (journey_id),
  total         integer NOT NULL,
  action_result jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_run_journey ON cdp.journey_run (journey_id);
