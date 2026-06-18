-- Migration 003 — Loyalty: sổ cái double-entry, balance = projection (KHÔNG cột mutable).
-- Luật (CLAUDE.md): double-entry, idempotency_key unique, reserve->capture->release,
-- cấm balance âm. Tài khoản logic theo chuỗi: member:{occ}:available | member:{occ}:reserved
-- | system:issued | system:redeemed. Mỗi txn: tổng delta = 0 (enforce ở DB + service).

CREATE TABLE IF NOT EXISTS cdp.loyalty_txn (
  txn_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  type            text NOT NULL,           -- earn|reserve|capture|release|adjust
  occ_id          uuid NULL REFERENCES cdp.occ_identity (occ_id),
  -- Fingerprint request (type+occ+points+ref) để replay cùng key nhưng KHÁC tham số
  -- bị từ chối (409) thay vì silently skip.
  fingerprint     text NOT NULL DEFAULT '',
  reason          text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_loyalty_idem UNIQUE (idempotency_key)
);

-- Mỗi dòng ledger: delta có dấu (cộng/trừ điểm). Bút toán kép -> tổng delta theo txn = 0.
CREATE TABLE IF NOT EXISTS cdp.loyalty_entry (
  entry_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_id     uuid NOT NULL REFERENCES cdp.loyalty_txn (txn_id),
  account    text NOT NULL,
  delta      bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_entry_account ON cdp.loyalty_entry (account);
CREATE INDEX IF NOT EXISTS idx_loyalty_entry_txn ON cdp.loyalty_entry (txn_id);

-- Đơn giữ điểm: gắn capture/release vào MỘT reservation cụ thể (state machine),
-- tránh consume nhầm reserve khác khi nhiều đơn giữ song song.
CREATE TABLE IF NOT EXISTS cdp.loyalty_reservation (
  reservation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occ_id         uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  points         bigint NOT NULL CHECK (points > 0),
  status         text NOT NULL DEFAULT 'held',   -- held|captured|released
  reserve_txn    uuid NOT NULL REFERENCES cdp.loyalty_txn (txn_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_reservation_status CHECK (status IN ('held', 'captured', 'released'))
);
CREATE INDEX IF NOT EXISTS idx_reservation_occ ON cdp.loyalty_reservation (occ_id);

-- Bảo vệ bất biến bút toán kép ở tầng DB: mỗi txn có tổng delta = 0 (deferred -> kiểm
-- lúc COMMIT, sau khi cả 2 dòng đã insert). Mọi writer lỗi đều bị DB chặn.
CREATE OR REPLACE FUNCTION cdp.assert_loyalty_balanced() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cdp.loyalty_entry WHERE txn_id = NEW.txn_id
    GROUP BY txn_id HAVING sum(delta) <> 0
  ) THEN
    RAISE EXCEPTION 'loyalty txn % không cân: tổng delta != 0', NEW.txn_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_loyalty_balanced ON cdp.loyalty_entry;
CREATE CONSTRAINT TRIGGER trg_loyalty_balanced
  AFTER INSERT ON cdp.loyalty_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION cdp.assert_loyalty_balanced();
