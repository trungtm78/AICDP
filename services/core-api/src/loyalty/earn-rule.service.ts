import type { Pool, PoolClient } from "pg";
import { postAutoEarnTx, MAX_POINTS } from "./loyalty.service.js";
import { getMemberEarnMultiplier } from "./tier.service.js";

// L3 — Earn rule engine (no-code, append-only + audit) + auto-earn từ canonical_transaction.
// Quy tắc tích điểm là DATA: rate theo tiền × multiplier, scope brand/kênh, điều kiện jsonb, phân
// biệt qualifying (tính hạng) vs non-qualifying. Auto-earn CHẠY NGOÀI ingest (scheduler quét txn
// chưa tích) — đúng CLAUDE.md. Idempotent theo message_id (key sys:autoearn:{message_id}).

export class EarnRuleError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EarnRuleError";
  }
}

export interface EarnRuleInput {
  ruleKey: string;
  name: string;
  currencyCode: string;         // code loại điểm tích vào (vd 'OCC_POINT', 'GIVRAL_PT')
  ratePerUnit: number;          // điểm / 1 đơn vị tiền
  multiplier?: number | undefined;
  brandId?: string | null | undefined;
  channel?: string | null | undefined;
  minAmount?: number | undefined;
  qualifying?: boolean | undefined;
  priority?: number | undefined;
  conditions?: Record<string, unknown> | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
}

export interface EarnRuleRow {
  id: string;
  ruleKey: string;
  version: number;
  name: string;
  brandId: string | null;
  channel: string | null;
  currencyId: string;
  currencyCode: string;
  ratePerUnit: number;
  multiplier: number;
  minAmount: number;
  qualifying: boolean;
  priority: number;
  conditions: Record<string, unknown>;
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
  updatedBy: string;
  createdAt: string;
}

async function resolveCurrencyId(db: Pool | PoolClient, code: string): Promise<string> {
  const r = await db.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code=$1 AND is_active", [code]);
  if (!r.rows[0]) throw new EarnRuleError("CURRENCY_NOT_FOUND", `Loại điểm không tồn tại: ${code}`);
  return r.rows[0]!.id;
}

/**
 * Tạo/ghi đè quy tắc theo `ruleKey` bằng APPEND-ONLY: version mới +1, các version cũ cùng key
 * set is_active=false (chỉ 1 version hiệu lực). Ghi audit bất biến. Trả rule vừa tạo.
 */
export async function setEarnRule(pool: Pool, input: EarnRuleInput, changedBy: string): Promise<EarnRuleRow> {
  if (!(input.ratePerUnit >= 0) || (input.multiplier !== undefined && !(input.multiplier >= 0))) {
    throw new EarnRuleError("INVALID_RULE", "rate_per_unit và multiplier phải >= 0.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`earn_rule:${input.ruleKey}`]);
    const currencyId = await resolveCurrencyId(client, input.currencyCode);
    const prev = await client.query<{ version: number; snapshot: unknown }>(
      `SELECT version, to_jsonb(r) AS snapshot FROM cdp.earn_rule r
        WHERE rule_key=$1 ORDER BY version DESC LIMIT 1`, [input.ruleKey]);
    const nextVersion = (prev.rows[0]?.version ?? 0) + 1;
    // Vô hiệu hoá mọi version cũ (giữ lịch sử, không xoá).
    await client.query("UPDATE cdp.earn_rule SET is_active=false WHERE rule_key=$1", [input.ruleKey]);
    const ins = await client.query<EarnRuleRowRaw>(
      `INSERT INTO cdp.earn_rule
         (rule_key, version, name, brand_id, channel, currency_id, rate_per_unit, multiplier,
          min_amount, qualifying, priority, conditions, valid_from, valid_to, is_active, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz,true,$15)
       RETURNING *`,
      [input.ruleKey, nextVersion, input.name, input.brandId ?? null, input.channel ?? null, currencyId,
       input.ratePerUnit, input.multiplier ?? 1, input.minAmount ?? 0, input.qualifying ?? true,
       input.priority ?? 100, JSON.stringify(input.conditions ?? {}), input.validFrom ?? null,
       input.validTo ?? null, changedBy],
    );
    await client.query(
      `INSERT INTO cdp.earn_rule_audit (rule_key, old_value, new_value, changed_by)
       VALUES ($1,$2,to_jsonb((SELECT r FROM cdp.earn_rule r WHERE r.id=$3)),$4)`,
      [input.ruleKey, prev.rows[0]?.snapshot ?? null, ins.rows[0]!.id, changedBy],
    );
    await client.query("COMMIT");
    return await hydrate(pool, ins.rows[0]!.id);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

interface EarnRuleRowRaw { id: string }

async function hydrate(db: Pool, id: string): Promise<EarnRuleRow> {
  const r = await db.query<Record<string, unknown>>(
    `SELECT r.*, c.code AS currency_code FROM cdp.earn_rule r
       JOIN cdp.point_currency c ON c.id=r.currency_id WHERE r.id=$1`, [id]);
  return mapRow(r.rows[0]!);
}

function mapRow(x: Record<string, unknown>): EarnRuleRow {
  return {
    id: x["id"] as string, ruleKey: x["rule_key"] as string, version: x["version"] as number,
    name: x["name"] as string, brandId: (x["brand_id"] as string) ?? null, channel: (x["channel"] as string) ?? null,
    currencyId: x["currency_id"] as string, currencyCode: x["currency_code"] as string,
    ratePerUnit: Number(x["rate_per_unit"]), multiplier: Number(x["multiplier"]), minAmount: Number(x["min_amount"]),
    qualifying: x["qualifying"] as boolean, priority: x["priority"] as number,
    conditions: (x["conditions"] as Record<string, unknown>) ?? {},
    validFrom: x["valid_from"] ? String(x["valid_from"]) : null,
    validTo: x["valid_to"] ? String(x["valid_to"]) : null, isActive: x["is_active"] as boolean,
    updatedBy: x["updated_by"] as string, createdAt: String(x["created_at"]),
  };
}

/** Liệt kê rule đang hiệu lực (is_active), kèm code currency. */
export async function listEarnRules(pool: Pool): Promise<EarnRuleRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT r.*, c.code AS currency_code FROM cdp.earn_rule r
       JOIN cdp.point_currency c ON c.id=r.currency_id
      WHERE r.is_active ORDER BY r.priority DESC, r.rule_key`);
  return r.rows.map(mapRow);
}

/** Lịch sử audit theo ruleKey (mới nhất trước). */
export async function listEarnRuleAudit(pool: Pool, ruleKey: string): Promise<Array<{ id: string; changedBy: string; changedAt: string }>> {
  const r = await pool.query<{ id: string; changed_by: string; changed_at: string }>(
    `SELECT id::text, changed_by, changed_at FROM cdp.earn_rule_audit WHERE rule_key=$1 ORDER BY id DESC`, [ruleKey]);
  return r.rows.map((x) => ({ id: x.id, changedBy: x.changed_by, changedAt: String(x.changed_at) }));
}

interface Candidate {
  id: string; currency_id: string; qualifying: boolean; pts: string;
  conditions: Record<string, unknown>;
}

/** Kiểm điều kiện jsonb bổ sung của rule so với giao dịch. Hỗ trợ: day_of_week[] (0=CN..6=T7 theo
 *  GIỜ VN, dow tính sẵn trong SQL at time zone Asia/Ho_Chi_Minh), payment_method (string|string[]).
 *  Mở rộng thêm khoá mới ở đây (data-driven). */
function conditionsPass(cond: Record<string, unknown>, dowVN: number, paymentMethod: string | null): boolean {
  const dow = cond["day_of_week"];
  if (Array.isArray(dow) && dow.length > 0 && !dow.includes(dowVN)) return false;
  const pm = cond["payment_method"];
  if (pm !== undefined) {
    const allowed = Array.isArray(pm) ? pm : [pm];
    if (!paymentMethod || !allowed.includes(paymentMethod)) return false;
  }
  return true;
}

/**
 * Tính điểm auto-earn cho MỘT canonical_transaction (theo message_id) + phát hành (earnScoped).
 * Chọn rule khớp có priority cao nhất (rồi cụ thể hơn) mà qua điều kiện; points=floor(total*rate*mult)
 * (SQL numeric, không float). Idempotent: 1 earn / message_id (key sys:autoearn). Luôn set
 * loyalty_earned=true kể cả khi không rule/points=0 (chống rescan). Trả điểm đã tích (0 nếu không).
 */
export async function earnForTransaction(pool: Pool, messageId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // CLAIM row (FOR UPDATE + loyalty_earned=false) -> atomic với set cờ, chống double-process đa
    // instance. dow tính theo GIỜ VN ngay trong SQL (chống lệch múi giờ điều kiện cuối tuần).
    const txnR = await client.query<{
      occ_id: string | null; brand_id: string; store_id: string | null; source: string;
      total: string; payment_method: string | null; occ_timestamp: string; dow: number;
    }>(
      `SELECT occ_id, brand_id, store_id, source, total::text AS total, payment_method,
              occ_timestamp,
              extract(dow FROM occ_timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS dow
         FROM cdp.canonical_transaction
        WHERE message_id=$1 AND loyalty_earned=false
        FOR UPDATE`,
      [messageId],
    );
    const t = txnR.rows[0];
    if (!t) { await client.query("COMMIT"); return 0; } // đã tích hoặc không tồn tại/đã bị instance khác claim
    if (!t.occ_id) { // giao dịch chưa gắn danh tính -> đánh dấu để không quét lại
      await client.query("UPDATE cdp.canonical_transaction SET loyalty_earned=true WHERE message_id=$1", [messageId]);
      await client.query("COMMIT");
      return 0;
    }
    // Serialize với các thao tác loyalty khác trên cùng occ (earn/reserve/... đều lock key này).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${t.occ_id}`]);
    // Window valid_from/valid_to kiểm theo THỜI ĐIỂM GIAO DỊCH (occ_timestamp) -> promo áp đúng dù
    // scheduler trễ; valid_from NULL = luôn hiệu lực (rule nền, áp cả backfill txn cũ). Tie-break:
    // priority -> cụ thể brand/channel -> min_amount cao hơn (ngưỡng chặt hơn) -> mới hơn.
    const cands = await client.query<Candidate>(
      `SELECT id, currency_id, qualifying, conditions,
              floor($3::numeric * rate_per_unit * multiplier)::bigint::text AS pts
         FROM cdp.earn_rule
        WHERE is_active
          AND (valid_from IS NULL OR valid_from <= $4::timestamptz)
          AND (valid_to IS NULL OR valid_to > $4::timestamptz)
          AND (brand_id IS NULL OR brand_id=$1) AND (channel IS NULL OR channel=$2)
          AND $3::bigint >= min_amount
        ORDER BY priority DESC, (brand_id IS NOT NULL) DESC, (channel IS NOT NULL) DESC,
                 min_amount DESC, valid_from DESC NULLS LAST, created_at DESC`,
      [t.brand_id, t.source, t.total, t.occ_timestamp],
    );
    const rule = cands.rows.find((c) => conditionsPass(c.conditions ?? {}, t.dow, t.payment_method));
    let earned = 0;
    if (rule) {
      // Cap trần an toàn (hóa đơn rất lớn × rate) -> KHÔNG để ném INVALID_AMOUNT làm kẹt record.
      const raw = BigInt(rule.pts);
      const ruleP = raw > BigInt(MAX_POINTS) ? MAX_POINTS : Number(raw);
      // Áp benefit hạng (L4): nhân earn_multiplier lớn nhất của hạng hiện tại rồi cap lại.
      const mult = await getMemberEarnMultiplier(client, t.occ_id);
      const points = Math.min(Math.floor(ruleP * mult), MAX_POINTS);
      if (points > 0) {
        earned = await postAutoEarnTx(client, {
          occId: t.occ_id, points, currencyId: rule.currency_id, messageId,
          brandId: t.brand_id, source: t.source, qualifying: rule.qualifying,
          ...(t.store_id ? { storeId: t.store_id } : {}),
        });
      }
    }
    await client.query("UPDATE cdp.canonical_transaction SET loyalty_earned=true WHERE message_id=$1", [messageId]);
    await client.query("COMMIT");
    return earned;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Quét các giao dịch chưa auto-earn (occ đã gắn) và tích điểm theo rule. Trả {processed, earned}. */
export async function processUnearnedTransactions(pool: Pool, limit = 500): Promise<{ processed: number; earned: number }> {
  const due = await pool.query<{ message_id: string }>(
    `SELECT message_id FROM cdp.canonical_transaction
      WHERE loyalty_earned=false AND occ_id IS NOT NULL
      ORDER BY received_at LIMIT $1`, [limit]);
  let processed = 0, earned = 0;
  for (const row of due.rows) {
    try {
      earned += await earnForTransaction(pool, row.message_id);
      processed++;
    } catch {
      // Lỗi 1 giao dịch không chặn cả lô (fail-safe); lần quét sau thử lại (loyalty_earned còn false).
    }
  }
  return { processed, earned };
}
