-- Migration 023 — Hash-chain cho consent_record (R3 governance, tamper-evident IPO-grade).
-- consent_record đã append-only (trigger chặn UPDATE/DELETE). Thêm chuỗi băm SHA-256:
-- row_hash = sha256(prev_hash || id || occ_id || purpose || status || source || recorded_at).
-- Sửa/xoá bất kỳ dòng nào (kể cả superuser tắt trigger) sẽ làm GÃY chuỗi ở các dòng sau →
-- phát hiện được (verifyConsentChain). Chuỗi GLOBAL theo id tăng dần; ghi serialize bằng
-- advisory lock 'consent-chain' trong recordConsent.

ALTER TABLE cdp.consent_record ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE cdp.consent_record ADD COLUMN IF NOT EXISTS row_hash  text;

CREATE INDEX IF NOT EXISTS idx_consent_id ON cdp.consent_record (id);
