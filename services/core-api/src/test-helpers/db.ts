import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

export async function setupTestDb(): Promise<void> {
  await runMigrations(pool);
  // Seed admin key test-local (migration KHÔNG seed credential — bảo mật). Raw khớp ADMIN_KEY.
  const hash = createHash("sha256").update("occ-dev-admin-key-2026").digest("hex");
  await pool.query(
    `INSERT INTO cdp.api_key (name, role, key_hash) VALUES ('test-admin','admin',$1)
     ON CONFLICT (key_hash) DO NOTHING`,
    [hash],
  );
}

export async function truncateAll(): Promise<void> {
  // Giữ cdp.brand (reference data seed sẵn); truncate phần còn lại.
  await pool.query(
    `TRUNCATE cdp.experiment_assignment, cdp.experiment, cdp.offer_catalog,
              cdp.analytics_alert, cdp.model_feature_importance, cdp.model_card, cdp.ml_model, cdp.customer_prediction,
              cdp.ai_llm_usage, cdp.ai_config_audit, cdp.ai_config, cdp.customer_feature,
              cdp.journey_step_run, cdp.journey_participant, cdp.journey_version,
              cdp.journey_run, cdp.journey, cdp.cart, cdp.password_reset,
              cdp.connector_delivery, cdp.connector_event,
              cdp.pipeline, cdp.connection, cdp.connector,
              cdp.activation_member, cdp.activation_run, cdp.consent_record,
              cdp.member_card,
              cdp.settlement_txn, cdp.liability_snapshot,
              cdp.member_challenge_progress, cdp.referral,
              cdp.voucher_redemption, cdp.voucher,
              cdp.member_tier_history, cdp.member_tier,
              cdp.earn_rule_audit, cdp.earn_rule,
              cdp.loyalty_lot, cdp.loyalty_entry, cdp.loyalty_reservation, cdp.loyalty_txn,
              cdp.canonical_transaction, cdp.ingest_event, cdp.identity_edge,
              cdp.identity_merge_log, cdp.profile, cdp.occ_identity,
              cdp.store, cdp.sku_mapping, cdp.product_master, cdp.product_category
     RESTART IDENTITY CASCADE`,
  );
}
