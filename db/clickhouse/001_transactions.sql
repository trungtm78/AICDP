-- ClickHouse OLAP schema (DB occ_cdp). Nguồn sự thật cho lớp analytics realtime.
-- Postgres vẫn là system-of-record (ACID); bảng này là PROJECTION từ canonical_transaction
-- (ingestion ghi sau khi PG commit). ReplacingMergeTree(ingested_at) theo message_id:
-- re-project/backfill idempotent (bản mới đè bản cũ); truy vấn dùng FINAL để dedup.

-- total Int64: VND KHÔNG có phần thập phân → tránh sai số làm tròn Float khi cộng dồn (khớp
-- bigint bên Postgres). ORDER BY (brand_id, occ_timestamp, message_id): tối ưu truy vấn
-- analytics theo brand+thời gian (prefix), VẪN giữ message_id trong key để ReplacingMergeTree
-- dedup đúng 1 dòng/giao dịch (re-project idempotent).
-- LƯU Ý: đổi schema cần DROP TABLE cũ (CREATE IF NOT EXISTS không alter) — CH là projection,
-- rebuild được từ Postgres; prod hiện chưa chạy CH nên không ảnh hưởng.
CREATE TABLE IF NOT EXISTS transactions (
  message_id String,
  occ_id String DEFAULT '',
  brand_id LowCardinality(String),
  store_id LowCardinality(String),
  source LowCardinality(String),
  pos_transaction_id String,
  currency LowCardinality(String),
  total Int64,
  occ_timestamp DateTime64(3, 'UTC'),
  ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
) ENGINE = ReplacingMergeTree(ingested_at)
ORDER BY (brand_id, occ_timestamp, message_id);
