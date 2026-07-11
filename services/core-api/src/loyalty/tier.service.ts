import type { Pool, PoolClient } from "pg";

// L4 — Tier engine (hạng thành viên hợp nhất coalition). Qualify theo SPEND/VISITS/POINTS trong cửa
// sổ xét (ROLLING/CALENDAR). Lên hạng TỨC THÌ; xuống hạng SOFT-LANDING (chỉ tại review_at + chỉ khi
// dưới ngưỡng giữ hạng — retention). Mỗi đổi hạng ghi member_tier_history bất biến (audit-grade).

export interface TierGroupRow {
  id: string; code: string; name: string; qualifyMetric: string;
  reviewCycle: string; reviewMonths: number; isActive: boolean;
}
export interface TierRow {
  id: string; tierGroupId: string; level: number; code: string; name: string;
  threshold: number; downgradeThreshold: number | null; benefits: Record<string, unknown>;
}
export interface MemberTierRow {
  tierGroupId: string; tierGroupCode: string; tierId: string; tierCode: string; tierName: string;
  level: number; qualifyingValue: number; effectiveFrom: string; reviewAt: string;
  benefits: Record<string, unknown>;
}

export async function listTierGroups(pool: Pool): Promise<TierGroupRow[]> {
  const r = await pool.query<Record<string, unknown>>("SELECT * FROM cdp.tier_group WHERE is_active ORDER BY code");
  return r.rows.map((x) => ({
    id: x["id"] as string, code: x["code"] as string, name: x["name"] as string,
    qualifyMetric: x["qualify_metric"] as string, reviewCycle: x["review_cycle"] as string,
    reviewMonths: x["review_months"] as number, isActive: x["is_active"] as boolean,
  }));
}

export async function listTiers(pool: Pool, tierGroupId: string): Promise<TierRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    "SELECT * FROM cdp.tier WHERE tier_group_id=$1 ORDER BY level", [tierGroupId]);
  return r.rows.map(mapTier);
}
function mapTier(x: Record<string, unknown>): TierRow {
  return {
    id: x["id"] as string, tierGroupId: x["tier_group_id"] as string, level: x["level"] as number,
    code: x["code"] as string, name: x["name"] as string, threshold: Number(x["threshold"]),
    downgradeThreshold: x["downgrade_threshold"] == null ? null : Number(x["downgrade_threshold"]),
    benefits: (x["benefits"] as Record<string, unknown>) ?? {},
  };
}

/** Hạng hiện tại của một khách (mọi nhóm). */
export async function getMemberTiers(pool: Pool, occId: string): Promise<MemberTierRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT mt.tier_group_id, g.code AS group_code, mt.tier_id, t.code AS tier_code, t.name AS tier_name,
            t.level, mt.qualifying_value, mt.effective_from, mt.review_at, t.benefits
       FROM cdp.member_tier mt
       JOIN cdp.tier_group g ON g.id=mt.tier_group_id
       JOIN cdp.tier t ON t.id=mt.tier_id
      WHERE mt.occ_id=$1 ORDER BY g.code`, [occId]);
  return r.rows.map((x) => ({
    tierGroupId: x["tier_group_id"] as string, tierGroupCode: x["group_code"] as string,
    tierId: x["tier_id"] as string, tierCode: x["tier_code"] as string, tierName: x["tier_name"] as string,
    level: x["level"] as number, qualifyingValue: Number(x["qualifying_value"]),
    effectiveFrom: String(x["effective_from"]), reviewAt: String(x["review_at"]),
    benefits: (x["benefits"] as Record<string, unknown>) ?? {},
  }));
}

/** Hệ số nhân điểm (earn_multiplier) lớn nhất trong các hạng hiện tại của khách (mặc định 1). Dùng
 *  cho auto-earn (L3) áp benefit hạng. Nhận Pool hoặc client trong txn. */
export async function getMemberEarnMultiplier(db: Pool | PoolClient, occId: string): Promise<number> {
  // Defensive: chỉ lấy earn_multiplier khi là SỐ trong jsonb (benefits cấu hình sai kiểu -> fallback 1,
  // KHÔNG để ::numeric ném lỗi làm chết auto-earn của khách). Lưu ý: model hiện 1 nhóm coalition-wide
  // (OCC_TIER áp mọi brand) -> MAX across nhóm là đúng; khi thêm nhóm theo brand cần scope theo brand.
  const r = await db.query<{ m: string }>(
    `SELECT COALESCE(max(CASE WHEN jsonb_typeof(t.benefits->'earn_multiplier')='number'
                              THEN (t.benefits->>'earn_multiplier')::numeric ELSE 1 END),1)::text AS m
       FROM cdp.member_tier mt JOIN cdp.tier t ON t.id=mt.tier_id WHERE mt.occ_id=$1`, [occId]);
  const m = Number(r.rows[0]?.m ?? 1);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

/** Biểu thức SQL mốc bắt đầu cửa sổ xét (tham số hoá months qua $2 — không nội suy chuỗi). */
function windowStartExpr(cycle: string): string {
  return cycle === "CALENDAR" ? "date_trunc('year', now())" : "now() - make_interval(months => $2)";
}

/** SQL tính giá trị metric qualify của khách trong cửa sổ xét của nhóm. */
async function computeMetric(client: PoolClient, occId: string, g: TierGroupRow): Promise<number> {
  const ws = windowStartExpr(g.reviewCycle);
  // CALENDAR: ws không tham chiếu $2 -> chỉ truyền $1 (tránh 'supplies 2 params but requires 1').
  const params: unknown[] = g.reviewCycle === "CALENDAR" ? [occId] : [occId, g.reviewMonths];
  if (g.qualifyMetric === "SPEND") {
    const r = await client.query<{ v: string }>(
      `SELECT COALESCE(sum(total),0)::text AS v FROM cdp.canonical_transaction
        WHERE occ_id=$1 AND occ_timestamp >= ${ws}`, params);
    return Number(r.rows[0]!.v);
  }
  if (g.qualifyMetric === "VISITS") {
    const r = await client.query<{ v: string }>(
      `SELECT count(*)::text AS v FROM cdp.canonical_transaction
        WHERE occ_id=$1 AND occ_timestamp >= ${ws}`, params);
    return Number(r.rows[0]!.v);
  }
  if (g.qualifyMetric === "POINTS") {
    // Σ điểm qualifying ĐÃ TÍCH (type='earn' AND qualifying) ở GROUP currency trong cửa sổ.
    const r = await client.query<{ v: string }>(
      `SELECT COALESCE(sum(e.delta),0)::text AS v
         FROM cdp.loyalty_entry e JOIN cdp.loyalty_txn t ON t.txn_id=e.txn_id
         JOIN cdp.point_currency c ON c.id=e.currency_id
        WHERE t.occ_id=$1 AND t.type='earn' AND t.qualifying AND e.delta>0
          AND c.code='OCC_POINT' AND t.created_at >= ${ws}`, params);
    return Number(r.rows[0]!.v);
  }
  return 0; // NIGHTS: hoãn tới tích hợp PMS (L8)
}

/**
 * Tính lại hạng của khách trong MỘT nhóm. Lên hạng tức thì; xuống hạng chỉ khi now>=review_at VÀ
 * dưới ngưỡng giữ hạng (retention/soft-landing). Ghi history mỗi lần đổi. Trả tier level hiện tại.
 */
export async function recomputeMemberTier(pool: Pool, occId: string, tierGroupId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock CÙNG KEY với các thao tác loyalty của occ (earn/reserve/...) -> khử race giữa recompute
    // hạng và auto-earn đọc earn_multiplier (điểm tất định: earn thấy hạng đã commit, không nửa vời).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${occId}`]);
    const gr = await client.query<Record<string, unknown>>("SELECT * FROM cdp.tier_group WHERE id=$1 AND is_active", [tierGroupId]);
    if (!gr.rows[0]) { await client.query("COMMIT"); return -1; }
    const g: TierGroupRow = {
      id: gr.rows[0]["id"] as string, code: gr.rows[0]["code"] as string, name: gr.rows[0]["name"] as string,
      qualifyMetric: gr.rows[0]["qualify_metric"] as string, reviewCycle: gr.rows[0]["review_cycle"] as string,
      reviewMonths: gr.rows[0]["review_months"] as number, isActive: true,
    };
    const tiersR = await client.query<Record<string, unknown>>(
      "SELECT * FROM cdp.tier WHERE tier_group_id=$1 ORDER BY level", [tierGroupId]);
    const tiers = tiersR.rows.map(mapTier);
    if (tiers.length === 0) { await client.query("COMMIT"); return -1; }
    const value = await computeMetric(client, occId, g);
    // Hạng đạt được = level cao nhất có threshold <= value (fallback level thấp nhất).
    const computed = [...tiers].reverse().find((t) => value >= t.threshold) ?? tiers[0]!;

    const mtR = await client.query<{ tier_id: string; past_review: boolean }>(
      "SELECT tier_id, (review_at <= now()) AS past_review FROM cdp.member_tier WHERE occ_id=$1 AND tier_group_id=$2 FOR UPDATE",
      [occId, tierGroupId]);
    // review_at cycle-aware: ROLLING = now + review_months; CALENDAR = đầu năm kế tiếp. reviewMonths là
    // int (DB, đã CHECK>0) nội suy an toàn kiểu số.
    const reviewExpr = g.reviewCycle === "CALENDAR"
      ? "date_trunc('year', now()) + interval '1 year'"
      : `now() + make_interval(months => ${g.reviewMonths})`;

    if (!mtR.rows[0]) {
      await client.query(
        `INSERT INTO cdp.member_tier (occ_id, tier_group_id, tier_id, qualifying_value, review_at)
         VALUES ($1,$2,$3,$4, ${reviewExpr})`, [occId, tierGroupId, computed.id, value]);
      await writeHistory(client, occId, tierGroupId, null, computed.id, "init", value);
      await client.query("COMMIT");
      return computed.level;
    }
    const current = tiers.find((t) => t.id === mtR.rows[0]!.tier_id);
    const nowPastReview = mtR.rows[0]!.past_review; // so theo giờ DB (now()), tránh lệch clock app
    if (!current) {
      // tier_id không còn trong cấu hình (hạng bị gỡ) -> gán lại theo computed (an toàn).
      await client.query(
        `UPDATE cdp.member_tier SET tier_id=$3, qualifying_value=$4, effective_from=now(),
           review_at=${reviewExpr}, updated_at=now() WHERE occ_id=$1 AND tier_group_id=$2`,
        [occId, tierGroupId, computed.id, value]);
      await writeHistory(client, occId, tierGroupId, null, computed.id, "review", value);
      await client.query("COMMIT");
      return computed.level;
    }

    if (computed.level > current.level) {
      // LÊN HẠNG tức thì -> reset chu kỳ giữ hạng.
      await client.query(
        `UPDATE cdp.member_tier SET tier_id=$3, qualifying_value=$4, effective_from=now(),
           review_at=${reviewExpr}, updated_at=now() WHERE occ_id=$1 AND tier_group_id=$2`,
        [occId, tierGroupId, computed.id, value]);
      await writeHistory(client, occId, tierGroupId, current.id, computed.id, "upgrade", value);
      await client.query("COMMIT");
      return computed.level;
    }
    if (computed.level < current.level) {
      const retention = current.downgradeThreshold;
      const belowRetention = retention == null ? true : value < retention;
      if (nowPastReview && belowRetention) {
        // XUỐNG HẠNG (soft-landing): chỉ tại review_at + dưới ngưỡng giữ hạng.
        await client.query(
          `UPDATE cdp.member_tier SET tier_id=$3, qualifying_value=$4, effective_from=now(),
             review_at=${reviewExpr}, updated_at=now() WHERE occ_id=$1 AND tier_group_id=$2`,
          [occId, tierGroupId, computed.id, value]);
        await writeHistory(client, occId, tierGroupId, current.id, computed.id, "downgrade", value);
        await client.query("COMMIT");
        return computed.level;
      }
    }
    // Giữ hạng: cập nhật qualifying_value; nếu qua review_at -> gia hạn chu kỳ (retention).
    await client.query(
      `UPDATE cdp.member_tier SET qualifying_value=$3, updated_at=now(),
         review_at=CASE WHEN review_at <= now() THEN ${reviewExpr} ELSE review_at END
       WHERE occ_id=$1 AND tier_group_id=$2`, [occId, tierGroupId, value]);
    await client.query("COMMIT");
    return current.level;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function writeHistory(
  client: PoolClient, occId: string, groupId: string, from: string | null, to: string, reason: string, value: number,
): Promise<void> {
  await client.query(
    `INSERT INTO cdp.member_tier_history (occ_id, tier_group_id, from_tier_id, to_tier_id, reason, qualifying_value)
     VALUES ($1,$2,$3,$4,$5,$6)`, [occId, groupId, from, to, reason, value]);
}

/**
 * Quét tính lại hạng, mọi nhóm active. KHÔNG dùng LIMIT-không-ORDER (gây starvation): (1) DRAIN đầy
 * đủ nhánh due-review (member tới review_at) theo lô có ORDER — mỗi khách xử lý xong review_at dời
 * tương lai nên thoát tập, không lặp vô hạn; (2) quét khách CÓ giao dịch trong cửa sổ, keyset theo
 * occ_id (không bỏ sót ai). `batch` chỉ là kích thước lô đọc, không phải trần bỏ sót.
 */
export async function recomputeAllTiers(pool: Pool, batch = 1000): Promise<{ groups: number; members: number }> {
  const groups = await listTierGroups(pool);
  let members = 0;
  const SAFETY = 500_000; // chặn vòng lặp vô hạn ngoài dự kiến
  for (const g of groups) {
    // (1) Due-review: drain hết (mỗi lượt xử lý dời review_at -> thoát tập).
    let guard = 0;
    for (;;) {
      const due = await pool.query<{ occ_id: string }>(
        `SELECT occ_id FROM cdp.member_tier WHERE tier_group_id=$1 AND review_at <= now()
          ORDER BY review_at, occ_id LIMIT $2`, [g.id, batch]);
      if (due.rows.length === 0) break;
      for (const row of due.rows) {
        try { await recomputeMemberTier(pool, row.occ_id, g.id); members++; } catch { /* fail-safe per member */ }
      }
      if (due.rows.length < batch || (guard += due.rows.length) > SAFETY) break;
    }
    // (2) Khách có giao dịch trong cửa sổ xét -> keyset theo occ_id (không bỏ sót). Nhóm CALENDAR dùng
    // đầu năm; ROLLING dùng review_months.
    const ws = windowStartExpr(g.reviewCycle);
    let cursor = "00000000-0000-0000-0000-000000000000";
    let scanned = 0;
    for (;;) {
      const act = await pool.query<{ occ_id: string }>(
        `SELECT DISTINCT occ_id FROM cdp.canonical_transaction
          WHERE occ_id IS NOT NULL AND occ_id > $1 AND occ_timestamp >= ${ws}
          ORDER BY occ_id LIMIT $3`, [cursor, g.reviewMonths, batch]);
      if (act.rows.length === 0) break;
      for (const row of act.rows) {
        try { await recomputeMemberTier(pool, row.occ_id, g.id); members++; } catch { /* fail-safe */ }
        cursor = row.occ_id;
      }
      if (act.rows.length < batch || (scanned += act.rows.length) > SAFETY) break;
    }
  }
  return { groups: groups.length, members };
}
