import type { Pool, PoolClient } from "pg";
import { postBonusEarnTx, LoyaltyError } from "./loyalty.service.js";

// L6 — Campaign + gamification. Challenge engine data-driven: SPEND/VISITS (progress theo cycle,
// repeatable, window), BIRTHDAY (quà sinh nhật/năm), REFERRAL (giới thiệu 2 chiều). Thưởng bonus
// điểm qualifying=false (không tính hạng). Idempotent theo key hệ thống (sys:challenge/birthday/referral).

export interface ChallengeRow {
  id: string; code: string; name: string; type: string; target: number;
  rewardPoints: number; rewardCurrencyId: string; brandId: string | null;
  windowDays: number | null; repeatable: boolean;
}
function mapChallenge(x: Record<string, unknown>): ChallengeRow {
  return {
    id: x["id"] as string, code: x["code"] as string, name: x["name"] as string, type: x["type"] as string,
    target: Number(x["target"]), rewardPoints: Number(x["reward_points"]), rewardCurrencyId: x["reward_currency_id"] as string,
    brandId: (x["brand_id"] as string) ?? null, windowDays: x["window_days"] == null ? null : Number(x["window_days"]),
    repeatable: x["repeatable"] as boolean,
  };
}

export async function listChallenges(pool: Pool): Promise<ChallengeRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT * FROM cdp.challenge WHERE is_active AND (valid_from IS NULL OR valid_from<=now())
       AND (valid_to IS NULL OR valid_to>now()) ORDER BY code`);
  return r.rows.map(mapChallenge);
}

export interface ProgressRow {
  challengeCode: string; type: string; cycle: number; progress: number; target: number;
  completedAt: string | null; rewardPoints: number;
}
export async function getMemberProgress(pool: Pool, occId: string): Promise<ProgressRow[]> {
  const r = await pool.query<Record<string, unknown>>(
    `SELECT ch.code, ch.type, mcp.cycle, mcp.progress, ch.target, mcp.completed_at, ch.reward_points
       FROM cdp.member_challenge_progress mcp JOIN cdp.challenge ch ON ch.id=mcp.challenge_id
      WHERE mcp.occ_id=$1 ORDER BY ch.code, mcp.cycle DESC`, [occId]);
  return r.rows.map((x) => ({
    challengeCode: x["code"] as string, type: x["type"] as string, cycle: x["cycle"] as number,
    progress: Number(x["progress"]), target: Number(x["target"]), completedAt: x["completed_at"] ? String(x["completed_at"]) : null,
    rewardPoints: Number(x["reward_points"]),
  }));
}

/** SQL tính metric SPEND/VISITS trong cửa sổ [max(startedAt, now-window_days), now]. GIỚI HẠN rolling
 *  window: hoạt động cũ ngoài window_days KHÔNG được tính (tránh tích lũy chậm nhiều tháng vẫn đạt). */
async function challengeMetric(client: PoolClient, occId: string, ch: ChallengeRow, startedAt: string): Promise<number> {
  // window_days là int (DB, CHECK>0) -> nội suy an toàn kiểu số; GREATEST chặn tính hoạt động ngoài cửa sổ.
  const startExpr = ch.windowDays != null
    ? `GREATEST($2::timestamptz, now() - make_interval(days => ${ch.windowDays}))`
    : "$2::timestamptz";
  const brandFilter = ch.brandId ? "AND brand_id=$3" : "";
  const params: unknown[] = ch.brandId ? [occId, startedAt, ch.brandId] : [occId, startedAt];
  const agg = ch.type === "VISITS" ? "count(*)" : "COALESCE(sum(total),0)";
  const r = await client.query<{ v: string }>(
    `SELECT ${agg}::text AS v FROM cdp.canonical_transaction
      WHERE occ_id=$1 AND occ_timestamp >= ${startExpr} ${brandFilter}`, params);
  return Number(r.rows[0]!.v);
}

/**
 * Cập nhật tiến độ mọi challenge SPEND/VISITS của MỘT khách + thưởng khi hoàn thành. Trong 1 txn +
 * advisory-lock occ (thưởng chạm ledger). Repeatable: hoàn thành -> mở cycle mới. window_days: cycle
 * quá hạn chưa hoàn thành -> reset started_at (rolling). Trả tổng điểm thưởng phát ra.
 */
export async function updateChallengesForMember(pool: Pool, occId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${occId}`]);
    const chs = (await client.query<Record<string, unknown>>(
      `SELECT * FROM cdp.challenge WHERE is_active AND type IN ('SPEND','VISITS')
         AND (valid_from IS NULL OR valid_from<=now()) AND (valid_to IS NULL OR valid_to>now())`)).rows.map(mapChallenge);
    let granted = 0;
    for (const ch of chs) {
      // Lấy cycle mới nhất (khóa).
      const cur = await client.query<{ id: string; cycle: number; completed_at: string | null }>(
        `SELECT id, cycle, completed_at FROM cdp.member_challenge_progress
          WHERE occ_id=$1 AND challenge_id=$2 ORDER BY cycle DESC LIMIT 1 FOR UPDATE`, [occId, ch.id]);
      let cycle: number, rowId: string;
      if (!cur.rows[0]) {
        // Cycle 1: đo từ [now - window_days] để tính hoạt động GẦN ĐÂY (không phải từ lúc tạo row =
        // now, sẽ loại hết giao dịch quá khứ). Non-windowed: từ now (tích lũy về sau).
        const ins = await client.query<{ id: string }>(
          `INSERT INTO cdp.member_challenge_progress (occ_id, challenge_id, cycle, started_at)
           VALUES ($1,$2,1, CASE WHEN $3::int IS NULL THEN now() ELSE now() - make_interval(days => $3::int) END) RETURNING id`,
          [occId, ch.id, ch.windowDays]);
        cycle = 1; rowId = ins.rows[0]!.id;
      } else if (cur.rows[0]!.completed_at) {
        if (!ch.repeatable) continue; // đã hoàn thành, không lặp
        cycle = cur.rows[0]!.cycle + 1;
        // Cycle kế đo TỪ completed_at cycle trước (chỉ hoạt động MỚI sau khi hoàn thành mới tính ->
        // không đếm trùng hoạt động đã thưởng, không cần "reset window").
        const ins = await client.query<{ id: string }>(
          "INSERT INTO cdp.member_challenge_progress (occ_id, challenge_id, cycle, started_at) VALUES ($1,$2,$3,$4) RETURNING id",
          [occId, ch.id, cycle, cur.rows[0]!.completed_at]);
        rowId = ins.rows[0]!.id;
      } else {
        cycle = cur.rows[0]!.cycle; rowId = cur.rows[0]!.id; // cycle đang mở -> giữ mốc đo
      }
      const st = await client.query<{ started_at: string }>("SELECT started_at FROM cdp.member_challenge_progress WHERE id=$1", [rowId]);
      const metric = await challengeMetric(client, occId, ch, st.rows[0]!.started_at);
      if (ch.target > 0 && metric >= ch.target) { // target>0 bắt buộc (chống target=0 -> spam thưởng mỗi tick)
        // Hoàn thành -> thưởng (idempotent theo cycle).
        const key = `sys:challenge:${occId}:${ch.id}:${cycle}`;
        const g = await postBonusEarnTx(client, {
          occId, points: ch.rewardPoints, currencyId: ch.rewardCurrencyId, idempotencyKey: key,
          reason: `challenge:${ch.code}`, ...(ch.brandId ? { brandId: ch.brandId } : {}),
        });
        granted += g;
        await client.query(
          "UPDATE cdp.member_challenge_progress SET progress=$2, completed_at=now(), reward_txn=(SELECT txn_id FROM cdp.loyalty_txn WHERE idempotency_key=$3), updated_at=now() WHERE id=$1",
          [rowId, metric, key]);
      } else {
        await client.query("UPDATE cdp.member_challenge_progress SET progress=$2, updated_at=now() WHERE id=$1", [rowId, metric]);
      }
    }
    await client.query("COMMIT");
    return granted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// ── Referral (giới thiệu 2 chiều) ──

/** Tạo mã giới thiệu cho referrer (1 mã/khách; trả mã sẵn có nếu đã tạo). */
export async function createReferralCode(pool: Pool, occId: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Advisory lock per occ + partial-unique index (migration) -> 1 mã pending/khách (chống TOCTOU).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`referral:${occId}`]);
    const existed = await client.query<{ code: string }>(
      "SELECT code FROM cdp.referral WHERE referrer_occ_id=$1 AND referee_occ_id IS NULL AND state='pending' LIMIT 1", [occId]);
    if (existed.rows[0]) { await client.query("COMMIT"); return existed.rows[0]!.code; }
    const r = await client.query<{ code: string }>(
      "INSERT INTO cdp.referral (code, referrer_occ_id) VALUES ('R'||upper(substr(md5(gen_random_uuid()::text),1,8)),$1) RETURNING code", [occId]);
    await client.query("COMMIT");
    return r.rows[0]!.code;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Referee dùng mã giới thiệu (gắn 1 lần). Không tự giới thiệu; 1 referee 1 mã. */
export async function joinReferral(pool: Pool, code: string, refereeOccId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rf = await client.query<{ id: string; referrer: string; state: string }>(
      "SELECT id, referrer_occ_id AS referrer, state FROM cdp.referral WHERE code=$1 FOR UPDATE", [code]);
    if (!rf.rows[0]) throw new LoyaltyError("REWARD_NOT_FOUND", "Mã giới thiệu không tồn tại.");
    if (rf.rows[0]!.referrer === refereeOccId) throw new LoyaltyError("INVALID_AMOUNT", "Không thể tự giới thiệu chính mình.");
    if (rf.rows[0]!.state !== "pending") throw new LoyaltyError("INVALID_AMOUNT", "Mã giới thiệu đã dùng.");
    const dupe = await client.query("SELECT 1 FROM cdp.referral WHERE referee_occ_id=$1", [refereeOccId]);
    if ((dupe.rowCount ?? 0) > 0) throw new LoyaltyError("INVALID_AMOUNT", "Khách đã được giới thiệu trước đó.");
    await client.query("UPDATE cdp.referral SET referee_occ_id=$2, state='joined', joined_at=now() WHERE id=$1",
      [rf.rows[0]!.id, refereeOccId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    // Race gắn cùng referee cho 2 mã -> unique violation (23505) -> lỗi nghiệp vụ sạch (không 500).
    if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
      throw new LoyaltyError("INVALID_AMOUNT", "Khách đã được giới thiệu trước đó.");
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Thưởng referral khi referee có GIAO DỊCH ĐẦU (≥1 earn qualifying). Thưởng CẢ HAI bên (referrer +
 * referee) theo challenge REFERRAL. Idempotent (state='rewarded' + key sys:referral). Trả điểm phát.
 */
export async function processReferralReward(pool: Pool, refereeOccId: string): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rf = await client.query<{ id: string; referrer: string; joined_at: string }>(
      "SELECT id, referrer_occ_id AS referrer, joined_at FROM cdp.referral WHERE referee_occ_id=$1 AND state='joined' FOR UPDATE", [refereeOccId]);
    if (!rf.rows[0]) { await client.query("COMMIT"); return 0; }
    // Điều kiện: referee có giao dịch SAU KHI join (giao dịch MỚI từ chương trình) — chống farming
    // bằng khách cũ đã có giao dịch trước đó.
    const hasTxn = await client.query(
      "SELECT 1 FROM cdp.canonical_transaction WHERE occ_id=$1 AND occ_timestamp > $2 LIMIT 1",
      [refereeOccId, rf.rows[0]!.joined_at]);
    if ((hasTxn.rowCount ?? 0) === 0) { await client.query("COMMIT"); return 0; }
    const ch = await client.query<Record<string, unknown>>(
      "SELECT * FROM cdp.challenge WHERE type='REFERRAL' AND is_active LIMIT 1");
    if (!ch.rows[0]) { await client.query("COMMIT"); return 0; }
    const c = mapChallenge(ch.rows[0]!);
    const referrer = rf.rows[0]!.referrer;
    // Lock cả 2 occ theo thứ tự (chống deadlock) — thưởng chạm ledger 2 người.
    const [lo, hi] = [referrer, refereeOccId].sort();
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${lo}`]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${hi}`]);
    let granted = 0;
    granted += await postBonusEarnTx(client, { occId: referrer, points: c.rewardPoints, currencyId: c.rewardCurrencyId,
      idempotencyKey: `sys:referral:${rf.rows[0]!.id}:referrer`, reason: "referral:referrer" });
    granted += await postBonusEarnTx(client, { occId: refereeOccId, points: c.rewardPoints, currencyId: c.rewardCurrencyId,
      idempotencyKey: `sys:referral:${rf.rows[0]!.id}:referee`, reason: "referral:referee" });
    await client.query("UPDATE cdp.referral SET state='rewarded', rewarded_at=now() WHERE id=$1", [rf.rows[0]!.id]);
    await client.query("COMMIT");
    return granted;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Quà sinh nhật (theo giờ VN): mỗi challenge BIRTHDAY -> khách có sinh nhật HÔM NAY, 1 lần/năm. */
export async function grantBirthdayBonus(pool: Pool): Promise<number> {
  const chs = (await pool.query<Record<string, unknown>>(
    "SELECT * FROM cdp.challenge WHERE type='BIRTHDAY' AND is_active")).rows.map(mapChallenge);
  let granted = 0;
  for (const ch of chs) {
    // Khớp ngày/tháng theo giờ VN. Sinh 29/2: năm KHÔNG nhuận -> thưởng vào 28/2 (fallback), năm nhuận
    // thưởng đúng 29/2.
    const members = await pool.query<{ occ_id: string; yr: number }>(
      `WITH d AS (SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date AS today)
       SELECT p.occ_id, extract(year FROM d.today)::int AS yr
         FROM cdp.profile p CROSS JOIN d
        WHERE p.birth_date IS NOT NULL
          AND (
            (extract(month FROM p.birth_date) = extract(month FROM d.today)
             AND extract(day FROM p.birth_date) = extract(day FROM d.today))
            OR (extract(month FROM p.birth_date)=2 AND extract(day FROM p.birth_date)=29
                AND extract(month FROM d.today)=2 AND extract(day FROM d.today)=28
                AND NOT (extract(year FROM d.today)::int % 4 = 0 AND (extract(year FROM d.today)::int % 100 <> 0 OR extract(year FROM d.today)::int % 400 = 0)))
          )`);
    for (const m of members.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`loyalty:${m.occ_id}`]);
        granted += await postBonusEarnTx(client, {
          occId: m.occ_id, points: ch.rewardPoints, currencyId: ch.rewardCurrencyId,
          idempotencyKey: `sys:birthday:${m.occ_id}:${ch.id}:${m.yr}`, reason: `challenge:${ch.code}`,
        });
        await client.query("COMMIT");
      } catch { await client.query("ROLLBACK"); } finally { client.release(); }
    }
  }
  return granted;
}
