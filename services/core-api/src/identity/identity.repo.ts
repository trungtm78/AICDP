import type { Pool, PoolClient } from "pg";
import {
  normalizeIdentifier,
  type IdentifierType,
  type NormalizedIdentifier,
} from "./normalize.js";
import { appendConsentRecord } from "../consent/consent.service.js";
import { consumeLotsFifoTx, createLotsFromSlicesTx } from "../loyalty/loyalty.service.js";

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
  mergedSink?: string[], // occ bị gộp (để caller invalidate cache Redis)
): Promise<string | null> {
  const normalized = raw
    .map((r) => normalizeIdentifier(r.type, r.value, opts))
    .filter((x): x is NormalizedIdentifier => x !== null);
  if (normalized.length === 0) return null;
  await acquireLocks(client, normalized);
  return resolveWithinTx(client, normalized, opts, mergedSink);
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
  mergedSink?: string[],
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
    await mergeOthers(client, occId, occIds, mergedSink);
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

/**
 * Merge occ `other` -> `survivor` re-point ĐẦY ĐỦ tiền + consent + dữ liệu dẫn xuất (fix R1.1).
 * Không chỉ dời edge/transaction: chuyển sổ điểm (double-entry cân bằng), tôn trọng consent đã
 * thu hồi, dời/gộp mọi bảng khoá theo occ. Chạy TRONG txn resolve. Advisory-lock loyalty theo
 * thứ tự tất định để không đua với earn/reserve.
 */
async function mergeOthers(
  client: PoolClient,
  survivor: string,
  occIds: string[],
  mergedSink?: string[],
): Promise<void> {
  for (const other of occIds.filter((id) => id !== survivor)) {
    mergedSink?.push(other); // để caller invalidate cache Redis profile:{other}/reco:{other}
    // Lock loyalty của cả hai theo thứ tự tất định (sort) — tránh deadlock với op loyalty.
    for (const id of [survivor, other].sort()) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${id}`]);
    }

    // Identity: edge + transaction + status.
    await client.query(
      "UPDATE cdp.identity_edge SET occ_id=$1, last_seen=now() WHERE occ_id=$2",
      [survivor, other],
    );
    await client.query(
      "UPDATE cdp.canonical_transaction SET occ_id=$1 WHERE occ_id=$2",
      [survivor, other],
    );

    // ── TIỀN: chuyển số dư loyalty (available + reserved) qua bút toán kép cân bằng ──
    await transferLoyalty(client, other, survivor, "available");
    await transferLoyalty(client, other, survivor, "reserved");
    // Dời lịch sử txn + reservation (capture/release theo đúng occ hợp nhất).
    await client.query("UPDATE cdp.loyalty_txn SET occ_id=$1 WHERE occ_id=$2", [survivor, other]);
    await client.query("UPDATE cdp.loyalty_reservation SET occ_id=$1 WHERE occ_id=$2", [survivor, other]);

    // ── CONSENT: append trạng thái hiệu lực (latest-wins across A∪B) cho survivor ──
    await mergeConsent(client, other, survivor);

    // ── Bảng dẫn xuất ──
    // profile: survivorship field-level (ưu tiên survivor, lấp trống bằng other) rồi xoá other.
    await client.query(
      `UPDATE cdp.profile s SET
         full_name = COALESCE(s.full_name, o.full_name),
         phone     = COALESCE(s.phone, o.phone),
         email     = COALESCE(s.email, o.email),
         birth_date= COALESCE(s.birth_date, o.birth_date),
         gender    = COALESCE(s.gender, o.gender),
         city      = COALESCE(s.city, o.city),
         updated_at= now()
       FROM cdp.profile o WHERE s.occ_id=$1 AND o.occ_id=$2`,
      [survivor, other],
    );
    await client.query("DELETE FROM cdp.profile WHERE occ_id=$1", [other]);
    // feature/prediction PK occ_id: xoá other (survivor được recompute sau).
    await client.query("DELETE FROM cdp.customer_feature WHERE occ_id=$1", [other]);
    await client.query("DELETE FROM cdp.customer_prediction WHERE occ_id=$1", [other]);
    // cart / activation_member: occ_id không unique → dời thẳng.
    await client.query("UPDATE cdp.cart SET occ_id=$1 WHERE occ_id=$2", [survivor, other]);
    await client.query("UPDATE cdp.activation_member SET occ_id=$1 WHERE occ_id=$2", [survivor, other]);
    // journey_participant UNIQUE(journey,occ) / experiment_assignment PK(exp,occ): dời cái không đụng, xoá phần trùng.
    await client.query(
      `UPDATE cdp.journey_participant p SET occ_id=$1 WHERE p.occ_id=$2
         AND NOT EXISTS (SELECT 1 FROM cdp.journey_participant q WHERE q.journey_id=p.journey_id AND q.occ_id=$1)`,
      [survivor, other],
    );
    await client.query("DELETE FROM cdp.journey_participant WHERE occ_id=$1", [other]);
    await client.query(
      `UPDATE cdp.experiment_assignment a SET occ_id=$1 WHERE a.occ_id=$2
         AND NOT EXISTS (SELECT 1 FROM cdp.experiment_assignment b WHERE b.experiment_id=a.experiment_id AND b.occ_id=$1)`,
      [survivor, other],
    );
    await client.query("DELETE FROM cdp.experiment_assignment WHERE occ_id=$1", [other]);

    // Đánh dấu merged + audit.
    await client.query(
      `UPDATE cdp.occ_identity SET status='merged', merged_into=$1, updated_at=now() WHERE occ_id=$2`,
      [survivor, other],
    );
    await client.query(
      `INSERT INTO cdp.identity_merge_log (survivor, merged, reason)
         VALUES ($1,$2,'deterministic-shared-identifier')`,
      [survivor, other],
    );
    // Lưu ý cache: profile:{other}/reco:{other} trong Redis tự hết theo TTL (1h/30m); occ merged
    // trả null khi build lại. Invalidation chủ động để ở R3 (tránh phụ thuộc Redis ở tầng repo).
  }
}

/** Chuyển số dư một loại account (available|reserved) từ `from` -> `to` bằng bút toán kép cân bằng. */
async function transferLoyalty(
  client: PoolClient,
  from: string,
  to: string,
  kind: "available" | "reserved",
): Promise<void> {
  const fromAcc = `member:${from}:${kind}`;
  const toAcc = `member:${to}:${kind}`;
  // Chuyển theo TỪNG currency (đa ví/coalition): mỗi currency có số dư khác 0 -> 1 txn cân bằng riêng.
  // Số dư giữ dạng string bigint (KHÔNG Number() — mất precision khi > 2^53 điểm); âm/dương hoá trong SQL.
  const balances = await client.query<{ currency_id: string; b: string }>(
    `SELECT currency_id, COALESCE(sum(delta),0)::bigint::text AS b
       FROM cdp.loyalty_entry WHERE account=$1 GROUP BY currency_id HAVING COALESCE(sum(delta),0) <> 0`,
    [fromAcc],
  );
  for (const row of balances.rows) {
    const amount = row.b; // string bigint
    const cur = row.currency_id;
    const key = `merge:${from}:${to}:${kind}:${cur}`;
    const txn = await client.query<{ txn_id: string }>(
      `INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint, reason)
       VALUES ($1,'adjust',$2,$1,'merge-transfer') RETURNING txn_id`,
      [key, to],
    );
    const txnId = txn.rows[0]!.txn_id;
    // debit from (-amount) / credit to (+amount) trong CÙNG currency: cân bằng per-currency.
    await client.query(
      "INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,(-$3::bigint),$4),($1,$5,$3::bigint,$4)",
      [txnId, fromAcc, amount, cur, toAcc],
    );
    // Đồng bộ lô (L2): lô bám tầng AVAILABLE -> merge available thì tiêu hết lô người bị gộp + tạo
    // lô cho survivor BẢO TOÀN expire_at gốc (không reset đáo hạn). Reserved không lot-tracked nên bỏ
    // qua. amount dạng string bigint (KHÔNG Number() — precision >2^53). amount = Σ lô from -> tiêu cạn.
    if (kind === "available") {
      const moved = await consumeLotsFifoTx(client, from, cur, amount);
      await createLotsFromSlicesTx(client, to, cur, moved, txnId);
    }
  }
}

/** Append trạng thái consent hiệu lực (bản ghi mới nhất across from∪to mỗi purpose) cho `to`. */
async function mergeConsent(client: PoolClient, from: string, to: string): Promise<void> {
  // Với mỗi purpose `from` từng có: lấy bản ghi mới nhất across cả hai occ. Nếu thuộc `from`
  // (tức from quyết định gần đây hơn to), append cho `to` để isAllowed(to) phản ánh đúng.
  const rows = await client.query<{ purpose: string; status: string; owner: string }>(
    `SELECT DISTINCT ON (purpose) purpose, status, occ_id::text AS owner
       FROM cdp.consent_record
      WHERE occ_id = ANY($1)
        AND purpose IN (SELECT DISTINCT purpose FROM cdp.consent_record WHERE occ_id=$2)
      ORDER BY purpose, recorded_at DESC, id DESC`,
    [[from, to], from],
  );
  for (const r of rows.rows) {
    if (r.owner === from) {
      // Append VÀO CHUỖI BĂM (tamper-evident) — không insert thô để tránh gãy chuỗi consent.
      await appendConsentRecord(client, {
        occId: to, purpose: r.purpose, status: r.status as "granted" | "withdrawn",
        source: "import", evidence: `identity-merge-from:${from}`,
      });
    }
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
