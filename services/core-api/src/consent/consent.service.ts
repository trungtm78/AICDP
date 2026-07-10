import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";

// Consent deny-by-default. Append-only audit; trạng thái hiện tại = bản ghi mới nhất theo
// (occ_id, purpose). Vắng mặt = denied. CHỈ activation gọi isAllowed() — ingestion/loyalty
// KHÔNG bao giờ gate ở đây (giao dịch/điểm luôn được ghi).
// TAMPER-EVIDENT: mỗi bản ghi có row_hash = sha256(prev_hash|occ|purpose|status|source|ts)
// tạo chuỗi băm GLOBAL (verifyConsentChain phát hiện sửa/xoá kể cả khi tắt trigger).

/**
 * Append 1 bản ghi consent VÀO CHUỖI BĂM (tamper-evident). Dùng chung bởi recordConsent + merge
 * danh tính. Serialize chuỗi bằng advisory lock 'consent-chain'. Tính hash TRƯỚC insert (không
 * UPDATE sau — trigger chặn UPDATE). Chạy trong txn của caller (client).
 */
export async function appendConsentRecord(
  client: PoolClient,
  a: RecordConsentArgs,
): Promise<{ id: string; status: ConsentStatus; recorded_at: string }> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext('consent-chain'))");
  const prev = await client.query<{ row_hash: string | null }>(
    "SELECT row_hash FROM cdp.consent_record ORDER BY id DESC LIMIT 1",
  );
  const prevHash = prev.rows[0]?.row_hash ?? "";
  const recordedAt = new Date();
  const content = [prevHash, a.occId, a.purpose, a.status, a.source, recordedAt.toISOString()].join("|");
  const rowHash = createHash("sha256").update(content).digest("hex");
  const r = await client.query<{ id: string; status: ConsentStatus; recorded_at: string }>(
    `INSERT INTO cdp.consent_record (occ_id, purpose, status, source, channel, evidence, recorded_at, prev_hash, row_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id::text, status, recorded_at`,
    [a.occId, a.purpose, a.status, a.source, a.channel ?? null, a.evidence ?? null, recordedAt, prevHash || null, rowHash],
  );
  return r.rows[0]!;
}

export interface ConsentChainResult {
  valid: boolean;
  total: number;
  brokenAtId: string | null; // id dòng đầu tiên gãy chuỗi (null nếu hợp lệ)
}

/** Duyệt chuỗi băm consent theo id tăng dần, tính lại row_hash — phát hiện sửa/xoá. */
export async function verifyConsentChain(pool: Pool): Promise<ConsentChainResult> {
  const rows = await pool.query<{
    id_text: string; occ_id: string; purpose: string; status: string; source: string;
    recorded_at: string; prev_hash: string | null; row_hash: string | null;
  }>(
    // LƯU Ý: alias id::text AS id_text (KHÔNG đặt tên 'id') — nếu đặt output 'id' sẽ CHE cột
    // bảng và ORDER BY id sort theo TEXT (1,10,100,...) làm duyệt chuỗi SAI thứ tự. Cần numeric.
    `SELECT id::text AS id_text, occ_id::text, purpose, status, source, recorded_at, prev_hash, row_hash
       FROM cdp.consent_record ORDER BY id ASC`,
  );
  let prevHash = "";
  for (const r of rows.rows) {
    if (r.row_hash === null) continue; // bản ghi cũ trước khi bật hash-chain (bỏ qua)
    const content = [prevHash, r.occ_id, r.purpose, r.status, r.source, new Date(r.recorded_at).toISOString()].join("|");
    const expected = createHash("sha256").update(content).digest("hex");
    if (expected !== r.row_hash || (r.prev_hash ?? "") !== prevHash) {
      return { valid: false, total: rows.rows.length, brokenAtId: r.id_text };
    }
    prevHash = r.row_hash;
  }
  return { valid: true, total: rows.rows.length, brokenAtId: null };
}

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
    const inserted = await appendConsentRecord(client, a); // vào chuỗi băm
    await client.query("COMMIT");
    return { purpose: a.purpose, status: inserted.status, recorded_at: inserted.recorded_at };
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
