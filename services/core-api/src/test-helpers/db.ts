import { pool } from "../db/pool.js";
import { runMigrations } from "../db/migrate.js";

export async function setupTestDb(): Promise<void> {
  await runMigrations(pool);
}

export async function truncateAll(): Promise<void> {
  await pool.query(
    `TRUNCATE cdp.canonical_transaction, cdp.ingest_event, cdp.identity_edge,
              cdp.identity_merge_log, cdp.profile, cdp.occ_identity
     RESTART IDENTITY CASCADE`,
  );
}
