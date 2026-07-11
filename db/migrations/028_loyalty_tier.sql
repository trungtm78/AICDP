-- Migration 028 — Tier engine (hạng thành viên hợp nhất coalition). Qualify theo SPEND/VISITS/POINTS
-- trong cửa sổ xét (ROLLING/CALENDAR). Lên hạng tức thì; xuống hạng soft-landing (chỉ tại review_at,
-- và chỉ khi dưới ngưỡng giữ hạng). Mỗi thay đổi hạng ghi history bất biến (audit-grade).

-- 1) Nhóm hạng (một chương trình hạng; có thể nhiều nhóm: F&B, Hotel...) -------------------------
CREATE TABLE IF NOT EXISTS cdp.tier_group (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE,
  name          text NOT NULL,
  qualify_metric text NOT NULL CHECK (qualify_metric IN ('SPEND','VISITS','POINTS','NIGHTS')),
  review_cycle  text NOT NULL DEFAULT 'ROLLING' CHECK (review_cycle IN ('ROLLING','CALENDAR')),
  review_months int  NOT NULL DEFAULT 12 CHECK (review_months > 0),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2) Các hạng trong nhóm (level tăng dần) -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.tier (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier_group_id  uuid NOT NULL REFERENCES cdp.tier_group (id) ON DELETE CASCADE,
  level          int  NOT NULL,                 -- 0 = hạng thấp nhất (mặc định)
  code           text NOT NULL,
  name           text NOT NULL,
  threshold      numeric NOT NULL DEFAULT 0 CHECK (threshold >= 0),          -- ngưỡng ĐẠT hạng
  downgrade_threshold numeric NULL CHECK (downgrade_threshold IS NULL OR downgrade_threshold >= 0), -- ngưỡng GIỮ hạng
  benefits       jsonb NOT NULL DEFAULT '{}',   -- vd { "earn_multiplier": 1.5 }
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tier_group_id, level),
  UNIQUE (tier_group_id, code)
);
CREATE INDEX IF NOT EXISTS idx_tier_group_level ON cdp.tier (tier_group_id, level);

-- 3) Hạng hiện tại của thành viên (1 dòng / occ / nhóm) -----------------------------------------
CREATE TABLE IF NOT EXISTS cdp.member_tier (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occ_id          uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  tier_group_id   uuid NOT NULL REFERENCES cdp.tier_group (id),
  tier_id         uuid NOT NULL REFERENCES cdp.tier (id),
  qualifying_value numeric NOT NULL DEFAULT 0,  -- giá trị metric kỳ hiện tại (lúc tính gần nhất)
  effective_from  timestamptz NOT NULL DEFAULT now(),
  review_at       timestamptz NOT NULL,         -- mốc xét xuống hạng (soft-landing)
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (occ_id, tier_group_id)
);
CREATE INDEX IF NOT EXISTS idx_member_tier_review ON cdp.member_tier (review_at);

-- 4) Lịch sử đổi hạng (append-only, audit-grade) ------------------------------------------------
CREATE TABLE IF NOT EXISTS cdp.member_tier_history (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occ_id         uuid NOT NULL,
  tier_group_id  uuid NOT NULL,
  from_tier_id   uuid NULL,
  to_tier_id     uuid NOT NULL,
  reason         text NOT NULL,                 -- upgrade | downgrade | init | review
  qualifying_value numeric NOT NULL,
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_member_tier_history ON cdp.member_tier_history (occ_id, tier_group_id, id DESC);

CREATE OR REPLACE FUNCTION cdp.prevent_member_tier_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cdp.member_tier_history là append-only: không được %', TG_OP;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_member_tier_history_immutable ON cdp.member_tier_history;
CREATE TRIGGER trg_member_tier_history_immutable
  BEFORE UPDATE OR DELETE ON cdp.member_tier_history
  FOR EACH ROW EXECUTE FUNCTION cdp.prevent_member_tier_history_mutation();

-- 5) Seed nhóm hạng coalition mặc định theo SPEND (chi tiêu 12 tháng rolling) + 4 hạng ----------
INSERT INTO cdp.tier_group (code, name, qualify_metric, review_cycle, review_months)
VALUES ('OCC_TIER', 'OCC Membership', 'SPEND', 'ROLLING', 12)
ON CONFLICT (code) DO NOTHING;

INSERT INTO cdp.tier (tier_group_id, level, code, name, threshold, downgrade_threshold, benefits)
SELECT g.id, v.level, v.code, v.name, v.threshold, v.downgrade, v.benefits::jsonb
  FROM cdp.tier_group g
  CROSS JOIN (VALUES
    (0, 'MEMBER',   'Member',   0,           NULL,        '{"earn_multiplier":1}'),
    (1, 'SILVER',   'Silver',   10000000,    8000000,     '{"earn_multiplier":1.25}'),
    (2, 'GOLD',     'Gold',     50000000,    40000000,    '{"earn_multiplier":1.5}'),
    (3, 'PLATINUM', 'Platinum', 150000000,   120000000,   '{"earn_multiplier":2}')
  ) AS v(level, code, name, threshold, downgrade, benefits)
 WHERE g.code = 'OCC_TIER'
ON CONFLICT (tier_group_id, level) DO NOTHING;
