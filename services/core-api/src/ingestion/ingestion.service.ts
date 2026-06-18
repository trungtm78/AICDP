import type { Pool, PoolClient } from "pg";
import { resolveOccIdTx, type RawIdentifier } from "../identity/identity.repo.js";
import { normalizeIdentifier } from "../identity/normalize.js";

export interface OrderCompletedEvent {
  brand_id: string;
  store_id: string;
  source: string;
  occ_timestamp: string;
  identifiers?: RawIdentifier[];
  properties: {
    pos_transaction_id: string;
    currency?: string;
    total: number;
    payment_method?: string;
    business_date?: string;
    items?: unknown[];
  };
}

export interface IdentifyEvent {
  brand_id: string;
  identifiers: RawIdentifier[];
  traits?: {
    full_name?: string;
    phone?: string;
    email?: string;
    birth_date?: string;
    gender?: string;
    city?: string;
  };
}

export interface IngestResult {
  messageId: string;
  occId: string | null;
  idempotent: boolean;
}

/** Khóa idempotency theo tracking-plan-spec: {brand}:{store}:{pos_transaction_id}. */
export function orderMessageId(ev: OrderCompletedEvent): string {
  return `${ev.brand_id}:${ev.store_id}:${ev.properties.pos_transaction_id}`;
}

export async function ingestOrderCompleted(
  pool: Pool,
  ev: OrderCompletedEvent,
): Promise<IngestResult> {
  const messageId = orderMessageId(ev);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<{ occ_id: string | null }>(
      "SELECT occ_id FROM cdp.canonical_transaction WHERE message_id=$1 FOR UPDATE",
      [messageId],
    );
    if (existing.rows.length > 0) {
      await client.query("COMMIT");
      return { messageId, occId: existing.rows[0]!.occ_id, idempotent: true };
    }

    const occId =
      ev.identifiers && ev.identifiers.length > 0
        ? await resolveOccIdTx(client, ev.identifiers, { brandId: ev.brand_id })
        : null;

    const ins = await client.query(
      `INSERT INTO cdp.canonical_transaction
         (message_id, occ_id, brand_id, store_id, source, pos_transaction_id,
          currency, total, payment_method, business_date, occ_timestamp, items)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        messageId,
        occId,
        ev.brand_id,
        ev.store_id,
        ev.source,
        ev.properties.pos_transaction_id,
        ev.properties.currency ?? "VND",
        ev.properties.total,
        ev.properties.payment_method ?? null,
        ev.properties.business_date ?? null,
        ev.occ_timestamp,
        JSON.stringify(ev.properties.items ?? []),
      ],
    );

    // rowCount=0 nghĩa là một transaction đồng thời đã chèn cùng message_id (đua
    // qua khe SELECT...FOR UPDATE ban đầu). Đây là idempotent thật: đọc lại occ_id
    // của bản ghi đã thắng, KHÔNG báo created (tránh occId/flag sai lệch).
    if (ins.rowCount === 0) {
      const winner = await client.query<{ occ_id: string | null }>(
        "SELECT occ_id FROM cdp.canonical_transaction WHERE message_id=$1",
        [messageId],
      );
      await client.query("COMMIT");
      return {
        messageId,
        occId: winner.rows[0]?.occ_id ?? occId,
        idempotent: true,
      };
    }

    await client.query("COMMIT");
    return { messageId, occId, idempotent: false };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function ingestIdentify(
  pool: Pool,
  ev: IdentifyEvent,
): Promise<{ occId: string | null }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const occId = await resolveOccIdTx(client, ev.identifiers, {
      brandId: ev.brand_id,
    });
    if (occId && ev.traits) {
      await applySurvivorship(client, occId, ev.traits);
    }
    await client.query("COMMIT");
    return { occId };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Survivorship v1: chỉ điền field còn trống (first-write-wins per field). */
async function applySurvivorship(
  client: PoolClient,
  occId: string,
  traits: IdentifyEvent["traits"] & object,
): Promise<void> {
  await client.query(
    `UPDATE cdp.profile SET
        full_name  = COALESCE(full_name, $2),
        phone      = COALESCE(phone, $3),
        email      = COALESCE(email, $4),
        birth_date = COALESCE(birth_date, $5),
        gender     = COALESCE(gender, $6),
        city       = COALESCE(city, $7),
        updated_at = now()
      WHERE occ_id = $1`,
    [
      occId,
      traits.full_name ?? null,
      traits.phone ?? null,
      traits.email ?? null,
      traits.birth_date ?? null,
      traits.gender ?? null,
      traits.city ?? null,
    ],
  );
}

export interface Customer360 {
  occId: string;
  profile: Record<string, unknown>;
  identifiers: Array<{ identifier_type: string; value_normalized: string }>;
  transactions: Array<Record<string, unknown>>;
}

export async function getCustomer360(
  pool: Pool,
  identifier: RawIdentifier,
  opts: { brandId?: string } = {},
): Promise<Customer360 | null> {
  const norm = normalizeIdentifier(identifier.type, identifier.value, opts);
  if (!norm) return null;

  const edge = await pool.query<{ occ_id: string }>(
    `SELECT occ_id FROM cdp.identity_edge
       WHERE identifier_type=$1 AND value_normalized=$2`,
    [norm.type, norm.valueNormalized],
  );
  const occId = edge.rows[0]?.occ_id;
  if (!occId) return null;

  const [profile, identifiers, transactions] = await Promise.all([
    pool.query(
      `SELECT full_name, phone, email, birth_date, gender, city
         FROM cdp.profile WHERE occ_id=$1`,
      [occId],
    ),
    pool.query(
      `SELECT identifier_type, value_normalized FROM cdp.identity_edge
         WHERE occ_id=$1 ORDER BY identifier_type`,
      [occId],
    ),
    pool.query(
      `SELECT message_id, brand_id, store_id, total, currency, occ_timestamp
         FROM cdp.canonical_transaction WHERE occ_id=$1 ORDER BY occ_timestamp DESC`,
      [occId],
    ),
  ]);

  return {
    occId,
    profile: profile.rows[0] ?? {},
    identifiers: identifiers.rows,
    transactions: transactions.rows,
  };
}
