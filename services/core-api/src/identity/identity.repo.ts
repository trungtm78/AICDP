import type { Pool, PoolClient } from "pg";
import {
  normalizeIdentifier,
  type IdentifierType,
  type NormalizedIdentifier,
} from "./normalize.js";

export interface RawIdentifier {
  type: IdentifierType;
  value: string;
}

export interface ResolveOptions {
  brandId?: string;
  provider?: string;
}

/**
 * Resolve danh sách identifier thô về MỘT occ_id (OCC ID), deterministic & race-free.
 * - Chuẩn hóa, bỏ identifier không hợp lệ.
 * - Advisory lock theo định danh mạnh (đã sort) để serialize concurrent resolve.
 * - Tạo mới nếu chưa có; nếu trùng nhiều occ_id -> merge non-destructive về survivor cũ nhất.
 * Trả null nếu không có identifier hợp lệ nào.
 */
/**
 * Resolve trong một transaction ĐÃ MỞ (caller quản lý BEGIN/COMMIT).
 * Dùng để compose cùng ingestion/loyalty trong một ACID transaction.
 */
export async function resolveOccIdTx(
  client: PoolClient,
  raw: RawIdentifier[],
  opts: ResolveOptions = {},
): Promise<string | null> {
  const normalized = raw
    .map((r) => normalizeIdentifier(r.type, r.value, opts))
    .filter((x): x is NormalizedIdentifier => x !== null);
  if (normalized.length === 0) return null;
  await acquireLocks(client, normalized);
  return resolveWithinTx(client, normalized, opts);
}

export async function resolveOccId(
  pool: Pool,
  raw: RawIdentifier[],
  opts: ResolveOptions = {},
): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const occId = await resolveOccIdTx(client, raw, opts);
    await client.query("COMMIT");
    return occId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function acquireLocks(
  client: PoolClient,
  normalized: NormalizedIdentifier[],
): Promise<void> {
  const keys = normalized
    .filter((n) => n.isStrong)
    .map((n) => `${n.type}:${n.valueNormalized}`)
    .sort(); // sort để tránh deadlock
  for (const key of keys) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
  }
}

async function resolveWithinTx(
  client: PoolClient,
  normalized: NormalizedIdentifier[],
  opts: ResolveOptions,
): Promise<string> {
  const tuples = normalized.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`);
  const params = normalized.flatMap((n) => [n.type, n.valueNormalized]);
  const existing = await client.query<{ occ_id: string }>(
    `SELECT DISTINCT occ_id FROM cdp.identity_edge
       WHERE (identifier_type, value_normalized) IN (${tuples.join(",")})`,
    params,
  );
  const occIds = existing.rows.map((r) => r.occ_id);

  let occId: string;
  if (occIds.length === 0) {
    occId = await createIdentity(client);
  } else {
    occId = await pickSurvivor(client, occIds);
    await mergeOthers(client, occId, occIds);
  }

  await upsertEdges(client, occId, normalized, opts);
  return occId;
}

async function createIdentity(client: PoolClient): Promise<string> {
  const ins = await client.query<{ occ_id: string }>(
    "INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id",
  );
  const occId = ins.rows[0]!.occ_id;
  await client.query(
    "INSERT INTO cdp.profile (occ_id) VALUES ($1) ON CONFLICT DO NOTHING",
    [occId],
  );
  return occId;
}

async function pickSurvivor(
  client: PoolClient,
  occIds: string[],
): Promise<string> {
  const r = await client.query<{ occ_id: string }>(
    `SELECT occ_id FROM cdp.occ_identity
       WHERE occ_id = ANY($1) ORDER BY created_at ASC, occ_id ASC LIMIT 1`,
    [occIds],
  );
  return r.rows[0]!.occ_id;
}

async function mergeOthers(
  client: PoolClient,
  survivor: string,
  occIds: string[],
): Promise<void> {
  for (const other of occIds.filter((id) => id !== survivor)) {
    await client.query(
      "UPDATE cdp.identity_edge SET occ_id=$1, last_seen=now() WHERE occ_id=$2",
      [survivor, other],
    );
    await client.query(
      "UPDATE cdp.canonical_transaction SET occ_id=$1 WHERE occ_id=$2",
      [survivor, other],
    );
    await client.query(
      `UPDATE cdp.occ_identity SET status='merged', merged_into=$1, updated_at=now()
         WHERE occ_id=$2`,
      [survivor, other],
    );
    await client.query(
      `INSERT INTO cdp.identity_merge_log (survivor, merged, reason)
         VALUES ($1,$2,'deterministic-shared-identifier')`,
      [survivor, other],
    );
  }
}

async function upsertEdges(
  client: PoolClient,
  occId: string,
  normalized: NormalizedIdentifier[],
  opts: ResolveOptions,
): Promise<void> {
  for (const n of normalized) {
    await client.query(
      `INSERT INTO cdp.identity_edge
         (occ_id, identifier_type, value_normalized, is_strong, source_brand)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (identifier_type, value_normalized)
       DO UPDATE SET last_seen = now()`,
      [occId, n.type, n.valueNormalized, n.isStrong, opts.brandId ?? null],
    );
  }
}
