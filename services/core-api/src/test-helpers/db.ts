import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

export async function setupTestDb(): Promise<void> {
  await runMigrations(pool);
}

export async function truncateAll(): Promise<void> {
  // Giữ cdp.brand (reference data seed sẵn); truncate phần còn lại.
  await pool.query(
    `TRUNCATE cdp.activation_member, cdp.activation_run, cdp.consent_record,
              cdp.loyalty_entry, cdp.loyalty_reservation, cdp.loyalty_txn,
              cdp.canonical_transaction, cdp.ingest_event, cdp.identity_edge,
              cdp.identity_merge_log, cdp.profile, cdp.occ_identity,
              cdp.store, cdp.sku_mapping, cdp.product_master, cdp.product_category
     RESTART IDENTITY CASCADE`,
  );
}
