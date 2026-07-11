import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import { setEarnRule, earnForTransaction } from "./earn-rule.service.js";
import { recomputeMemberTier, getMemberTiers, recomputeAllTiers } from "./tier.service.js";

let occId: string;
let groupId: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
  groupId = (await pool.query<{ id: string }>("SELECT id FROM cdp.tier_group WHERE code='OCC_TIER'")).rows[0]!.id;
});

let seq = 0;
async function spend(total: number, time = "2026-07-11T10:00:00Z"): Promise<string> {
  const mid = `tx-${++seq}`;
  await pool.query(
    `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, source, pos_transaction_id, total, occ_timestamp)
     VALUES ($1,$2,'givral','pos',$3,$4,$5)`, [mid, occId, `p-${mid}`, total, time]);
  return mid;
}
async function tier(): Promise<{ code: string; level: number } | undefined> {
  const ts = await getMemberTiers(pool, occId);
  const g = ts.find((t) => t.tierGroupCode === "OCC_TIER");
  return g ? { code: g.tierCode, level: g.level } : undefined;
}
async function history(): Promise<Array<{ reason: string }>> {
  const r = await pool.query<{ reason: string }>("SELECT reason FROM cdp.member_tier_history WHERE occ_id=$1 ORDER BY id", [occId]);
  return r.rows;
}

describe("L4 — tier init + upgrade (SPEND, ROLLING 12m)", () => {
  it("chi tiêu 12M -> Silver (init); history 'init'", async () => {
    await spend(12_000_000);
    const lvl = await recomputeMemberTier(pool, occId, groupId);
    expect(lvl).toBe(1);
    expect((await tier())!.code).toBe("SILVER");
    expect((await history()).map((h) => h.reason)).toEqual(["init"]);
  });

  it("chi tiêu thêm vượt Gold -> LÊN HẠNG tức thì (level 2); history upgrade", async () => {
    await spend(12_000_000);
    await recomputeMemberTier(pool, occId, groupId); // Silver
    await spend(40_000_000); // tổng 52M -> Gold
    const lvl = await recomputeMemberTier(pool, occId, groupId);
    expect(lvl).toBe(2);
    expect((await tier())!.code).toBe("GOLD");
    expect((await history()).map((h) => h.reason)).toEqual(["init", "upgrade"]);
  });
});

describe("L4 — downgrade soft-landing + retention", () => {
  it("value tụt về 0 nhưng CHƯA tới review_at -> GIỮ hạng (soft-landing); ép review quá khứ -> xuống hạng", async () => {
    const big = await spend(52_000_000);
    await recomputeMemberTier(pool, occId, groupId); // Gold
    expect((await tier())!.level).toBe(2);
    // đẩy giao dịch RA NGOÀI cửa sổ 12 tháng -> value=0, nhưng review_at còn tương lai
    await pool.query("UPDATE cdp.canonical_transaction SET occ_timestamp=now()-interval '13 months' WHERE message_id=$1", [big]);
    await recomputeMemberTier(pool, occId, groupId);
    expect((await tier())!.level).toBe(2); // GIỮ Gold (chưa review)
    // ép review_at quá khứ -> xuống hạng
    await pool.query("UPDATE cdp.member_tier SET review_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    await recomputeMemberTier(pool, occId, groupId);
    expect((await tier())!.level).toBe(0); // Member
    expect((await history()).map((h) => h.reason)).toContain("downgrade");
  });

  it("tại review_at nhưng value >= ngưỡng GIỮ hạng -> RETENTION (không xuống)", async () => {
    const keep = await spend(45_000_000); // Silver ngưỡng
    const extra = await spend(15_000_000); // tổng 60M -> Gold
    await recomputeMemberTier(pool, occId, groupId);
    expect((await tier())!.level).toBe(2); // Gold
    // đẩy phần 15M ra ngoài cửa sổ -> value còn 45M (>= downgrade_threshold Gold=40M, < threshold 50M)
    await pool.query("UPDATE cdp.canonical_transaction SET occ_timestamp=now()-interval '13 months' WHERE message_id=$1", [extra]);
    await pool.query("UPDATE cdp.member_tier SET review_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    await recomputeMemberTier(pool, occId, groupId);
    expect((await tier())!.level).toBe(2); // GIỮ Gold (retention: 45M >= 40M)
    expect(keep).toBeTruthy();
  });
});

describe("L4 — recomputeAllTiers (quét, chống starvation)", () => {
  it("xuống hạng khách tới review DÙ không còn giao dịch trong cửa sổ (nhánh due-review)", async () => {
    const big = await spend(52_000_000);
    await recomputeMemberTier(pool, occId, groupId); // Gold
    await pool.query("UPDATE cdp.canonical_transaction SET occ_timestamp=now()-interval '13 months' WHERE message_id=$1", [big]);
    await pool.query("UPDATE cdp.member_tier SET review_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    const r = await recomputeAllTiers(pool);
    expect(r.members).toBeGreaterThanOrEqual(1);
    expect((await tier())!.level).toBe(0); // đã xuống Member qua quét (không cần giao dịch mới)
  });
});

describe("L4 — defensive earn_multiplier (JSON xấu không làm chết auto-earn)", () => {
  it("benefits earn_multiplier sai kiểu -> fallback x1, earn vẫn chạy", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    await spend(12_000_000);
    await recomputeMemberTier(pool, occId, groupId); // Silver
    await pool.query(`UPDATE cdp.tier SET benefits='{"earn_multiplier":"vip"}'::jsonb WHERE code='SILVER'`);
    try {
      const mid = await spend(100_000);
      const earned = await earnForTransaction(pool, mid);
      expect(earned).toBe(100); // fallback x1 (không ném lỗi numeric)
    } finally {
      // Khôi phục benefits seed (tier là reference data, KHÔNG truncate giữa test).
      await pool.query(`UPDATE cdp.tier SET benefits='{"earn_multiplier":1.25}'::jsonb WHERE code='SILVER'`);
    }
  });
});

describe("L4 — benefit earn_multiplier áp vào auto-earn (L3↔L4)", () => {
  it("khách Silver (x1.25): giao dịch 100.000đ -> 125 điểm (rule 100 × 1.25)", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    await spend(12_000_000); // -> Silver
    await recomputeMemberTier(pool, occId, groupId);
    expect((await tier())!.code).toBe("SILVER");
    const mid = await spend(100_000);
    const earned = await earnForTransaction(pool, mid);
    expect(earned).toBe(125); // floor(floor(100000*0.001) * 1.25) = floor(100*1.25)
    expect((await getBalance(pool, occId)).available).toBe(125);
  });
});
