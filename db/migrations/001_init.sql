-- Migration 001 — schema lõi GĐ1: identity (OCC ID) + canonical transaction + profile.
-- Ràng buộc correctness theo review: UNIQUE(identifier_type, value_normalized),
-- merge qua version (không destructive), materialized edge (không traverse graph runtime).

CREATE SCHEMA IF NOT EXISTS cdp;

-- Master OCC identity (một con người = một occ_id)
CREATE TABLE IF NOT EXISTS cdp.occ_identity (
  occ_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status           text NOT NULL DEFAULT 'active',
  merged_into      uuid NULL REFERENCES cdp.occ_identity (occ_id),
  identity_version integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Edge: identifier đã chuẩn hóa -> occ_id (materialized resolved_identifier).
-- UNIQUE biến race thành thao tác atomic (DB là trọng tài).
CREATE TABLE IF NOT EXISTS cdp.identity_edge (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occ_id           uuid NOT NULL REFERENCES cdp.occ_identity (occ_id),
  identifier_type  text NOT NULL,
  value_normalized text NOT NULL,
  is_strong        boolean NOT NULL,
  source_brand     text NULL,
  source_channel   text NULL,
  first_seen       timestamptz NOT NULL DEFAULT now(),
  last_seen        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_identifier UNIQUE (identifier_type, value_normalized)
);
CREATE INDEX IF NOT EXISTS idx_edge_occ ON cdp.identity_edge (occ_id);

-- Golden record (survivorship tối thiểu v1)
CREATE TABLE IF NOT EXISTS cdp.profile (
  occ_id     uuid PRIMARY KEY REFERENCES cdp.occ_identity (occ_id),
  full_name  text NULL,
  phone      text NULL,
  email      text NULL,
  birth_date date NULL,
  gender     text NULL,
  city       text NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Nhật ký merge (bất biến, audit)
CREATE TABLE IF NOT EXISTS cdp.identity_merge_log (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  survivor     uuid NOT NULL,
  merged       uuid NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Giao dịch canonical (idempotent theo message_id = {brand}:{store}:{pos_transaction_id})
CREATE TABLE IF NOT EXISTS cdp.canonical_transaction (
  message_id         text PRIMARY KEY,
  occ_id             uuid NULL REFERENCES cdp.occ_identity (occ_id),
  brand_id           text NOT NULL,
  store_id           text NULL,
  source             text NOT NULL,
  pos_transaction_id text NOT NULL,
  currency           text NOT NULL DEFAULT 'VND',
  total              bigint NOT NULL,
  payment_method     text NULL,
  business_date      date NULL,
  occ_timestamp      timestamptz NOT NULL,
  items              jsonb NOT NULL DEFAULT '[]',
  received_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_txn_occ ON cdp.canonical_transaction (occ_id);

-- Log event ingest (idempotency cho event phi-giao-dịch như identify) + audit
CREATE TABLE IF NOT EXISTS cdp.ingest_event (
  message_id  text PRIMARY KEY,
  type        text NOT NULL,
  brand_id    text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
