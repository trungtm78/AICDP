-- Migration 030 — Campaign + gamification: challenge engine data-driven (SPEND/VISITS/BIRTHDAY/REFERRAL),
-- progress theo cycle (repeatable), thưởng bonus điểm (qualifying=false — không tính hạng). Khung mở
-- rộng cho streak/lì xì (thêm type + logic). Referral 2 chiều (referrer + referee cùng thưởng).

-- 1) Định nghĩa challenge -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.challenge (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  name               text NOT NULL,
  type               text NOT NULL CHECK (type IN ('SPEND','VISITS','BIRTHDAY','REFERRAL')),
  target             numeric NOT NULL DEFAULT 0 CHECK (target >= 0),  -- ngưỡng hoàn thành (BIRTHDAY bỏ qua)
  reward_points      bigint NOT NULL CHECK (reward_points > 0),
  reward_currency_id uuid NOT NULL REFERENCES cdp.point_currency (id),
  brand_id           text NULL REFERENCES cdp.brand (brand_id),       -- NULL = mọi brand
  window_days        int NULL,                                        -- cửa sổ tính progress (NULL = từ started_at)
  repeatable         boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  valid_from         timestamptz NULL,
  valid_to           timestamptz NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_challenge_active ON cdp.challenge (is_active, type);
-- SPEND/VISITS phải có target > 0 (target=0 + repeatable -> thưởng mỗi tick, lạm phát điểm).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ck_challenge_target_positive') THEN
    ALTER TABLE cdp.challenge ADD CONSTRAINT ck_challenge_target_positive
      CHECK (type NOT IN ('SPEND','VISITS') OR target > 0);
  END IF;
END $$;

-- 2) Tiến độ challenge của thành viên (theo cycle) ----------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.member_challenge_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occ_id        uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  challenge_id  uuid NOT NULL REFERENCES cdp.challenge (id),
  cycle         int  NOT NULL DEFAULT 1,
  progress      numeric NOT NULL DEFAULT 0,
  completed_at  timestamptz NULL,
  reward_txn    uuid NULL REFERENCES cdp.loyalty_txn (txn_id),
  started_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (occ_id, challenge_id, cycle)
);
CREATE INDEX IF NOT EXISTS idx_mcp_occ ON cdp.member_challenge_progress (occ_id, challenge_id);

-- 3) Referral (giới thiệu) — 2 chiều ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.referral (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,
  referrer_occ_id uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  referee_occ_id  uuid NULL REFERENCES cdp.occ_identity (occ_id),
  state          text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','joined','rewarded')),
  joined_at      timestamptz NULL,
  rewarded_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_referral_referrer ON cdp.referral (referrer_occ_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_referee ON cdp.referral (referee_occ_id) WHERE referee_occ_id IS NOT NULL;
-- 1 mã pending / referrer (chống tạo nhiều mã rác song song).
CREATE UNIQUE INDEX IF NOT EXISTS uq_referral_pending ON cdp.referral (referrer_occ_id)
  WHERE referee_occ_id IS NULL AND state='pending';

-- 4) Seed vài challenge mẫu (thưởng điểm CHUNG OCC_POINT) ---------------------------------------
INSERT INTO cdp.challenge (code, name, type, target, reward_points, reward_currency_id, window_days, repeatable)
SELECT * FROM (
  SELECT 'SPEND_1M_MONTH', 'Chi tiêu 1 triệu trong tháng +200đ', 'SPEND', 1000000, 200::bigint, c.id, 30, true FROM cdp.point_currency c WHERE c.code='OCC_POINT'
  UNION ALL
  SELECT 'VISIT_5_MONTH', 'Ghé 5 lần trong tháng +100đ', 'VISITS', 5, 100::bigint, c.id, 30, true FROM cdp.point_currency c WHERE c.code='OCC_POINT'
  UNION ALL
  SELECT 'BIRTHDAY_BONUS', 'Quà sinh nhật +500đ', 'BIRTHDAY', 0, 500::bigint, c.id, NULL::int, true FROM cdp.point_currency c WHERE c.code='OCC_POINT'
  UNION ALL
  SELECT 'REFERRAL_BONUS', 'Giới thiệu bạn +300đ mỗi bên', 'REFERRAL', 0, 300::bigint, c.id, NULL::int, true FROM cdp.point_currency c WHERE c.code='OCC_POINT'
) v
ON CONFLICT (code) DO NOTHING;
