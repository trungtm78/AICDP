-- Connector LIVE (chạy THẬT): token cổng vào inbound, OAuth state (refresh token), health-check,
-- cursor reverse-ETL, và 2 nhật ký nhận/gửi để quan sát + tính data-summary.

-- Mở rộng connection cho vận hành thật.
ALTER TABLE cdp.connection
  ADD COLUMN IF NOT EXISTS inbound_token_hash text,       -- sha256 token webhook (reveal raw 1 lần)
  ADD COLUMN IF NOT EXISTS oauth_state       jsonb,       -- {access_token(enc),refresh_token(enc),expires_at}
  ADD COLUMN IF NOT EXISTS last_checked_at   timestamptz, -- lần health-check gần nhất
  ADD COLUMN IF NOT EXISTS last_error        text,        -- lỗi health-check gần nhất
  ADD COLUMN IF NOT EXISTS pull_cursor       jsonb;       -- con trỏ reverse-ETL (keyset)

CREATE INDEX IF NOT EXISTS idx_connection_inbound_token
  ON cdp.connection (inbound_token_hash) WHERE inbound_token_hash IS NOT NULL;

-- Nhật ký INBOUND: mỗi event nhận qua webhook/reverse-ETL (ingested|rejected). KHÔNG lưu payload/secret.
CREATE TABLE IF NOT EXISTS cdp.connector_event (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES cdp.connection(id) ON DELETE CASCADE,
  received_at   timestamptz NOT NULL DEFAULT now(),
  event_type    text NOT NULL,                 -- order_completed|identify|payment|...
  message_id    text,
  occ_id        uuid,
  status        text NOT NULL CHECK (status IN ('ingested', 'rejected')),
  error         text
);
CREATE INDEX IF NOT EXISTS idx_connector_event_conn
  ON cdp.connector_event (connection_id, received_at DESC);

-- Nhật ký OUTBOUND: mỗi lần gửi ra destination (activation delivery + test-send). occ null = test-send.
CREATE TABLE IF NOT EXISTS cdp.connector_delivery (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  connection_id       uuid NOT NULL REFERENCES cdp.connection(id) ON DELETE CASCADE,
  run_id              uuid,                     -- activation_run.run_id (null nếu test-send)
  occ_id              uuid,
  channel             text NOT NULL,           -- zalo_zns|webhook|email|sms|...
  recipient           text,                    -- phone/email/url đã dùng (KHÔNG phải secret)
  status              text NOT NULL CHECK (status IN ('sent', 'failed', 'skipped_no_contact')),
  provider_message_id text,
  error               text,
  attempts            int NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  delivered_at        timestamptz
);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_conn
  ON cdp.connector_delivery (connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connector_delivery_run
  ON cdp.connector_delivery (run_id) WHERE run_id IS NOT NULL;
