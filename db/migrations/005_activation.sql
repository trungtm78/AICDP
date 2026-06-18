-- Migration 005 — Activation: kích hoạt audience tới destination, GATE bằng consent.
-- Đây là nơi DUY NHẤT consent được enforce (deny-by-default): người chưa granted bị suppress.
-- ingestion/loyalty KHÔNG gate. Lưu run + member để audit ai được gửi / ai bị chặn vì sao.

CREATE TABLE IF NOT EXISTS cdp.activation_run (
  run_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_name    text NOT NULL,
  purpose          text NOT NULL,
  channel          text NOT NULL,
  destination      text NOT NULL,
  total            integer NOT NULL,
  allowed_count    integer NOT NULL,
  suppressed_count integer NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.activation_member (
  id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id   uuid NOT NULL REFERENCES cdp.activation_run (run_id),
  occ_id   uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  decision text NOT NULL CHECK (decision IN ('allowed', 'suppressed_no_consent'))
);
CREATE INDEX IF NOT EXISTS idx_activation_member_run ON cdp.activation_member (run_id);
