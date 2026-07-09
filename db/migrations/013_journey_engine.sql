-- Migration 013 — Journey engine: orchestration đa bước (state machine + tick worker).
-- Mở rộng journey (007, 1-step) sang graph `definition` + versioning; thêm participant +
-- step_run để chạy BỀN VỮNG trong Postgres (tick, effectively-once qua step_run unique).
-- Backward-compat: journey 007 cũ giữ nguyên (definition=null) → legacy run() vẫn chạy;
-- engine mới CHỈ xử lý journey có `definition`.
--
--   journey ──1:N── journey_version (snapshot bất biến khi publish)
--   journey ──1:N── journey_participant (1 occ_id/journey: once-ever)
--   journey_participant ──1:N── journey_step_run (append-only; UNIQUE(participant,node))
--
--   participant.status: active ──tick advance──► completed | exited | failed
--                       active ──wait──► (next_run_at += delay, vẫn active)

-- 1) Mở rộng cdp.journey (graph + trigger + versioning + trạng thái mở rộng)
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS definition jsonb;
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS trigger_type text;
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS trigger_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS published_version int;
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS allow_re_enroll boolean NOT NULL DEFAULT false;
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cdp.journey ADD COLUMN IF NOT EXISTS published_at timestamptz;

-- Mở rộng enum status: cũ (active|archived) -> (draft|active|paused|archived).
ALTER TABLE cdp.journey DROP CONSTRAINT IF EXISTS journey_status_check;
ALTER TABLE cdp.journey ADD CONSTRAINT journey_status_check
  CHECK (status IN ('draft','active','paused','archived'));
-- trigger_type null-able (journey 007 cũ = null); mới: event|segment|manual.
ALTER TABLE cdp.journey DROP CONSTRAINT IF EXISTS journey_trigger_type_check;
ALTER TABLE cdp.journey ADD CONSTRAINT journey_trigger_type_check
  CHECK (trigger_type IS NULL OR trigger_type IN ('event','segment','manual'));

-- 2) Snapshot version bất biến — participant chạy theo version đã publish.
CREATE TABLE IF NOT EXISTS cdp.journey_version (
  journey_id   uuid NOT NULL REFERENCES cdp.journey (journey_id) ON DELETE CASCADE,
  version      int NOT NULL,
  definition   jsonb NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  published_by text,
  PRIMARY KEY (journey_id, version)
);

-- 3) Participant — trạng thái chạy per (journey, occ). UNIQUE(journey,occ) = once-ever.
CREATE TABLE IF NOT EXISTS cdp.journey_participant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id      uuid NOT NULL REFERENCES cdp.journey (journey_id) ON DELETE CASCADE,
  version         int NOT NULL,
  occ_id          uuid NOT NULL,
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','completed','exited','failed')),
  current_node_id text,
  next_run_at     timestamptz NOT NULL DEFAULT now(),
  attempts        int NOT NULL DEFAULT 0,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  exit_reason     text,
  UNIQUE (journey_id, occ_id)
);
-- Index tick: chỉ participant đang chờ chạy (partial → gọn khi completed nhiều).
CREATE INDEX IF NOT EXISTS idx_jp_due ON cdp.journey_participant (next_run_at)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_jp_journey ON cdp.journey_participant (journey_id, status);

-- 4) Step run — log append-only; UNIQUE(participant,node) = idempotency effectively-once.
CREATE TABLE IF NOT EXISTS cdp.journey_step_run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES cdp.journey_participant (id) ON DELETE CASCADE,
  node_id        text NOT NULL,
  node_type      text NOT NULL,
  status         text NOT NULL CHECK (status IN ('done','skipped','failed')),
  result         jsonb NOT NULL DEFAULT '{}',
  ran_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (participant_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_jsr_participant ON cdp.journey_step_run (participant_id);

-- 5) Idempotency cho activation khi gọi từ journey (chống gửi trùng lúc tick replay/crash).
ALTER TABLE cdp.activation_run ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS uq_activation_idem
  ON cdp.activation_run (idempotency_key) WHERE idempotency_key IS NOT NULL;
