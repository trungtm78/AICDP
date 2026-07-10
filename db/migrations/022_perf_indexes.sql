-- Migration 022 — Index hiệu năng (R2/DATA-1.1). Analytics/forecast/attribution quét
-- canonical_transaction theo brand + thời gian; khi ClickHouse chưa chạy (fallback PG) trước
-- đây phải seq-scan. Composite index (brand_id, occ_timestamp DESC) + index thời gian toàn cục.

CREATE INDEX IF NOT EXISTS idx_txn_brand_time
  ON cdp.canonical_transaction (brand_id, occ_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_txn_time
  ON cdp.canonical_transaction (occ_timestamp DESC);

-- journey_participant: attribution/report quét theo occ_id (merge cũng dùng).
CREATE INDEX IF NOT EXISTS idx_jp_occ ON cdp.journey_participant (occ_id);
