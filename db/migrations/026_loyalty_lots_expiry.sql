-- Migration 026 — Point lots (lô điểm) + chính sách đáo hạn + breakage.
-- Lô = batch điểm phát hành có hạn dùng; tiêu FIFO theo expire_at; hết hạn -> breakage (giảm
-- liability, ghi nhận doanh thu vỡ). Lô bám tầng AVAILABLE: available = Σ lô 'active'.remaining
-- (per occ, currency). Additive + idempotent; KHÔNG phá kernel double-entry.

-- 1) Chính sách đáo hạn theo currency ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.expiration_policy (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_id     uuid NOT NULL UNIQUE REFERENCES cdp.point_currency (id),
  mode            text NOT NULL DEFAULT 'ROLLING' CHECK (mode IN ('NONE','ROLLING','FIXED')),
  duration_months int NULL,   -- ROLLING: earned_at + N tháng; FIXED: cuối năm dương lịch của (earn + N tháng)
  is_active       boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_exp_duration CHECK (mode = 'NONE' OR duration_months IS NOT NULL)
);
-- Seed mặc định ROLLING 24 tháng cho mọi loại điểm hiện có (admin chỉnh sau qua config).
INSERT INTO cdp.expiration_policy (currency_id, mode, duration_months)
SELECT id, 'ROLLING', 24 FROM cdp.point_currency
ON CONFLICT (currency_id) DO NOTHING;

-- 2) Lô điểm ------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.loyalty_lot (
  lot_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occ_id             uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  currency_id        uuid NOT NULL REFERENCES cdp.point_currency (id),
  points_original    bigint NOT NULL CHECK (points_original > 0),
  points_remaining   bigint NOT NULL CHECK (points_remaining >= 0),
  earn_txn           uuid NULL REFERENCES cdp.loyalty_txn (txn_id),
  issuing_company_id uuid NULL REFERENCES cdp.company (id),
  earned_at          timestamptz NOT NULL DEFAULT now(),
  expire_at          timestamptz NULL,   -- NULL = vô hạn (policy NONE)
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','exhausted','expired')),
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- FIFO: tiêu lô hết hạn SỚM nhất trước (NULLS LAST -> lô vô hạn tiêu sau cùng).
CREATE INDEX IF NOT EXISTS idx_lot_fifo ON cdp.loyalty_lot (occ_id, currency_id, expire_at) WHERE status = 'active';
-- Scheduler đáo hạn: quét lô active đã tới hạn.
CREATE INDEX IF NOT EXISTS idx_lot_expire ON cdp.loyalty_lot (expire_at) WHERE status = 'active';

-- 2b) Lô đã tiêu bởi mỗi reservation (để release TRẢ LẠI đúng lô + BẢO TOÀN expire_at gốc, không
-- reset đồng hồ đáo hạn -> chống "điểm bất tử" qua reserve/release; capture thì bỏ luôn). jsonb:
-- [{ "e": <expire_at ISO|null>, "p": <points> }].
ALTER TABLE cdp.loyalty_reservation ADD COLUMN IF NOT EXISTS consumed_lots jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 3) BACKFILL lô cho số dư available ĐÃ TỒN TẠI trước L2 (điểm kernel cũ) -----------------------
-- Nếu không backfill: available > 0 nhưng Σ lô active = 0 -> reserve/convert/adjust-/transfer/merge
-- đều ném INSUFFICIENT_BALANCE (rollback), khoá điểm cũ + làm sập ingest khi merge danh tính.
-- Idempotent: chỉ tạo khi (occ,currency) có available>0 mà CHƯA có lô active phủ. Grandfather
-- expiry theo policy hiện hành (đồng hồ từ now) để điểm cũ vẫn tham gia breakage, không chết ngay.
INSERT INTO cdp.loyalty_lot (occ_id, currency_id, points_original, points_remaining, expire_at)
SELECT s.occ_id, s.currency_id, s.bal, s.bal,
       (SELECT CASE p.mode
                 WHEN 'NONE'    THEN NULL
                 WHEN 'ROLLING' THEN now() + (p.duration_months || ' months')::interval
                 WHEN 'FIXED'   THEN date_trunc('year', now() + (p.duration_months || ' months')::interval)
                                     + interval '1 year' - interval '1 second'
               END FROM cdp.expiration_policy p WHERE p.currency_id = s.currency_id AND p.is_active)
FROM (
  SELECT (substring(account from 'member:(.*):available'))::uuid AS occ_id,
         currency_id, sum(delta) AS bal
    FROM cdp.loyalty_entry
   WHERE account LIKE 'member:%:available'
   GROUP BY 1, currency_id
  HAVING sum(delta) > 0
) s
WHERE NOT EXISTS (
  SELECT 1 FROM cdp.loyalty_lot l
   WHERE l.occ_id = s.occ_id AND l.currency_id = s.currency_id AND l.status = 'active'
);
