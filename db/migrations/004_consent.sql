-- Migration 004 — Consent: deny-by-default chokepoint (append-only audit).
-- Luật (CLAUDE.md): deny-by-default; ingestion + loyalty LUÔN nhận giao dịch (KHÔNG gate),
-- chỉ ACTIVATION mới gate consent. Trạng thái hiện tại = bản ghi mới nhất theo (occ, purpose);
-- vắng mặt = denied. Append-only (audit-grade hướng IPO) — DB chặn UPDATE/DELETE.

CREATE TABLE IF NOT EXISTS cdp.consent_record (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occ_id      uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  purpose     text NOT NULL CHECK (purpose IN
                ('marketing_email','marketing_sms','marketing_zalo','personalization','data_sharing')),
  status      text NOT NULL CHECK (status IN ('granted', 'withdrawn')),
  source      text NOT NULL CHECK (source IN ('pos','web','csr','import','api')),
  channel     text NULL CHECK (channel IS NULL OR length(channel) <= 100),
  evidence    text NULL CHECK (evidence IS NULL OR length(evidence) <= 2000),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_latest
  ON cdp.consent_record (occ_id, purpose, recorded_at DESC, id DESC);

-- Append-only: chặn UPDATE/DELETE ở tầng DB (TRUNCATE cho test vẫn được phép vì bỏ qua
-- trigger row-level). Bảo vệ tính toàn vẹn lịch sử consent.
CREATE OR REPLACE FUNCTION cdp.prevent_consent_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cdp.consent_record là append-only: không được %', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_consent_immutable ON cdp.consent_record;
CREATE TRIGGER trg_consent_immutable
  BEFORE UPDATE OR DELETE ON cdp.consent_record
  FOR EACH ROW EXECUTE FUNCTION cdp.prevent_consent_mutation();
