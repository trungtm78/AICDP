-- Connector & Pipeline Builder (low-code): kết nối hệ thống ngoài + pipeline ETL kéo-thả.
-- Demo-grade: lưu cấu hình + trạng thái; RudderStack là xương sống giai đoạn tích hợp thật.

-- Connector tuỳ biến do user tạo (hệ thống ngoài bất kỳ); catalog = tĩnh (code) ∪ bảng này.
CREATE TABLE IF NOT EXISTS cdp.connector (
  key           text PRIMARY KEY,
  name          text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('source', 'destination')),
  category      text NOT NULL,
  transport     text NOT NULL CHECK (transport IN ('rest', 'webhook', 'database', 'sdk', 'warehouse')),
  config_schema jsonb NOT NULL DEFAULT '[]',   -- [{key,label,type,placeholder,secret?}]
  blurb         text NULL,
  is_custom     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Kết nối đã cấu hình (một source hoặc destination cụ thể).
CREATE TABLE IF NOT EXISTS cdp.connection (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  direction     text NOT NULL CHECK (direction IN ('source', 'destination')),
  connector_key text NOT NULL,
  config        jsonb NOT NULL DEFAULT '{}',
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'draft', 'error')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connection_direction ON cdp.connection (direction);

-- Pipeline ETL kéo-thả: nodes (source/transform/destination) + edges — như cdp.journey.definition.
CREATE TABLE IF NOT EXISTS cdp.pipeline (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'event_stream' CHECK (kind IN ('event_stream', 'etl', 'reverse_etl')),
  definition  jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('active', 'paused', 'draft')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
