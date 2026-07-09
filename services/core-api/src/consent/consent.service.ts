import type { Pool } from "pg";

// Consent deny-by-default. Append-only audit; trạng thái hiện tại = bản ghi mới nhất theo
// (occ_id, purpose). Vắng mặt = denied. CHỈ activation gọi isAllowed() — ingestion/loyalty
// KHÔNG bao giờ gate ở đây (giao dịch/điểm luôn được ghi).

export type ConsentStatus = "granted" | "withdrawn";
export type EffectiveStatus = ConsentStatus | "denied";

export interface RecordConsentArgs {
  occId: string;
  purpose: string;
  status: ConsentStatus;
  source: string;
  channel?: string;
  evidence?: string;
}

export interface ConsentState {
  purpose: string;
  status: EffectiveStatus;
  recorded_at: string | null;
}

/**
 * Ghi một sự kiện consent (append-only). Trả trạng thái hiệu lực sau khi ghi.
 * Serialize theo (occ_id, purpose) bằng advisory lock để trạng thái trả về luôn phản
 * ánh đúng bản ghi mới nhất (tránh interleave khi 2 caller ghi cùng purpose).
 */
export async function recordConsent(
  pool: Pool,
  a: RecordConsentArgs,
): Promise<ConsentState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `consent:${a.occId}:${a.purpose}`,
    ]);
    await client.query(
      `INSERT INTO cdp.consent_record (occ_id, purpose, status, source, channel, evidence)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [a.occId, a.purpose, a.status, a.source, a.channel ?? null, a.evidence ?? null],
    );
    const r = await client.query<{ status: ConsentStatus; recorded_at: string }>(
      `SELECT status, recorded_at FROM cdp.consent_record
         WHERE occ_id=$1 AND purpose=$2
         ORDER BY recorded_at DESC, id DESC LIMIT 1`,
      [a.occId, a.purpose],
    );
    await client.query("COMMIT");
    const row = r.rows[0]!;
    return { purpose: a.purpose, status: row.status, recorded_at: row.recorded_at };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Trạng thái hiệu lực của MỘT purpose. Vắng mặt -> 'denied' (deny-by-default). */
export async function getConsent(
  pool: Pool,
  occId: string,
  purpose: string,
): Promise<ConsentState> {
  const r = await pool.query<{ status: ConsentStatus; recorded_at: string }>(
    `SELECT status, recorded_at FROM cdp.consent_record
       WHERE occ_id=$1 AND purpose=$2
       ORDER BY recorded_at DESC, id DESC LIMIT 1`,
    [occId, purpose],
  );
  const row = r.rows[0];
  if (!row) return { purpose, status: "denied", recorded_at: null };
  return { purpose, status: row.status, recorded_at: row.recorded_at };
}

/**
 * CHOKEPOINT deny-by-default cho ACTIVATION. true CHỈ khi bản ghi mới nhất = 'granted'.
 * KHÔNG dùng ở ingestion/loyalty.
 */
export async function isAllowed(
  pool: Pool,
  occId: string,
  purpose: string,
): Promise<boolean> {
  const state = await getConsent(pool, occId, purpose);
  return state.status === "granted";
}

export interface ConsentHistoryEntry {
  status: ConsentStatus;
  source: string;
  channel: string | null;
  evidence: string | null;
  recordedAt: string;
}

/** Drill-down: timeline append-only các sự kiện consent của MỘT (occId, purpose). */
export async function listConsentHistory(
  pool: Pool,
  occId: string,
  purpose: string,
): Promise<ConsentHistoryEntry[]> {
  const r = await pool.query<{ status: ConsentStatus; source: string; channel: string | null; evidence: string | null; recorded_at: string }>(
    `SELECT status, source, channel, evidence, recorded_at
       FROM cdp.consent_record
       WHERE occ_id=$1 AND purpose=$2
       ORDER BY recorded_at DESC, id DESC`,
    [occId, purpose],
  );
  return r.rows.map((row) => ({
    status: row.status, source: row.source, channel: row.channel, evidence: row.evidence, recordedAt: row.recorded_at,
  }));
}

/** Trạng thái hiện tại của MỌI purpose mà khách từng có bản ghi. */
export async function listConsents(pool: Pool, occId: string): Promise<ConsentState[]> {
  const r = await pool.query<{ purpose: string; status: ConsentStatus; recorded_at: string }>(
    `SELECT DISTINCT ON (purpose) purpose, status, recorded_at
       FROM cdp.consent_record
       WHERE occ_id=$1
       ORDER BY purpose, recorded_at DESC, id DESC`,
    [occId],
  );
  return r.rows.map((row) => ({
    purpose: row.purpose,
    status: row.status,
    recorded_at: row.recorded_at,
  }));
}
