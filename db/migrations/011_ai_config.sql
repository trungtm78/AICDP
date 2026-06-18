-- Migration 011 — AI Config & Governance: cấu hình AI (RBAC admin) + audit append-only.
-- Lưu cấu hình theo SECTION (key = 'rfm'|'reco'|'forecast'|'decisioning'|'features'|'llm'),
-- value jsonb. Nguồn DEFAULTS nằm trong ai-config.service.ts (bảng rỗng vẫn chạy an toàn).
-- Mọi thay đổi ghi audit bất biến (audit-grade hướng IPO) — DB chặn UPDATE/DELETE trên audit.

CREATE TABLE IF NOT EXISTS cdp.ai_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cdp.ai_config_audit (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text NOT NULL,
  old_value  jsonb NULL,
  new_value  jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_config_audit_key
  ON cdp.ai_config_audit (key, changed_at DESC, id DESC);

-- Append-only cho audit: chặn UPDATE/DELETE (TRUNCATE test vẫn được, bỏ qua trigger row-level).
CREATE OR REPLACE FUNCTION cdp.prevent_ai_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cdp.ai_config_audit là append-only: không được %', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_audit_immutable ON cdp.ai_config_audit;
CREATE TRIGGER trg_ai_audit_immutable
  BEFORE UPDATE OR DELETE ON cdp.ai_config_audit
  FOR EACH ROW EXECUTE FUNCTION cdp.prevent_ai_audit_mutation();
