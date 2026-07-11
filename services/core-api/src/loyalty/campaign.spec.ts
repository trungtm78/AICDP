import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import {
  updateChallengesForMember, getMemberProgress, createReferralCode, joinReferral,
  processReferralReward, grantBirthdayBonus,
} from "./campaign.service.js";

let occId: string;
let occB: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  occId = (await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id")).rows[0]!.occ_id;
  occB = (await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id")).rows[0]!.occ_id;
});

let seq = 0;
async function spend(occ: string, total: number, time?: string): Promise<void> {
  // time undefined -> dùng now() DB (giao dịch "vừa xảy ra"); truyền chuỗi để cố định.
  const tsExpr = time === undefined ? "now()" : "$5::timestamptz";
  const params: unknown[] = time === undefined ? [`c-${++seq}`, occ, `p-${seq}`, total] : [`c-${++seq}`, occ, `p-${seq}`, total, time];
  await pool.query(
    `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, source, pos_transaction_id, total, occ_timestamp)
     VALUES ($1,$2,'givral','pos',$3,$4,${tsExpr})`, params);
}

describe("L6 — challenge SPEND/VISITS (progress + thưởng + repeatable)", () => {
  it("SPEND_1M_MONTH: chi tiêu đủ 1 triệu -> thưởng 200đ, progress completed", async () => {
    await spend(occId, 600_000);
    let g = await updateChallengesForMember(pool, occId);
    expect((await getBalance(pool, occId)).available).toBe(0); // chưa đủ (600k<1M)
    await spend(occId, 500_000); // tổng 1.1M
    g = await updateChallengesForMember(pool, occId);
    expect(g).toBeGreaterThanOrEqual(200);
    expect((await getBalance(pool, occId)).available).toBe(200); // +200 bonus (chỉ SPEND, VISITS 2 lần <5)
    const prog = await getMemberProgress(pool, occId);
    const spendCh = prog.find((p) => p.challengeCode === "SPEND_1M_MONTH");
    expect(spendCh!.completedAt).not.toBeNull();
  });

  it("VISITS_5_MONTH repeatable: đủ 5 lần -> thưởng; thêm 5 lần nữa -> cycle mới thưởng lần 2", async () => {
    for (let i = 0; i < 5; i++) await spend(occId, 100_000); // 500k (<1M, không kích SPEND) + 5 visits
    await updateChallengesForMember(pool, occId);
    // VISITS thưởng 100; SPEND chưa (500k<1M)
    expect((await getBalance(pool, occId)).available).toBe(100);
    for (let i = 0; i < 5; i++) await spend(occId, 100_000); // thêm 5 visits (tổng 10, cycle 2)
    const g = await updateChallengesForMember(pool, occId);
    expect(g).toBeGreaterThanOrEqual(100); // cycle 2 VISITS thưởng thêm
    const prog = await getMemberProgress(pool, occId);
    const cycles = prog.filter((p) => p.challengeCode === "VISIT_5_MONTH");
    expect(cycles.length).toBeGreaterThanOrEqual(2); // 2 cycle
  });

  it("rolling window: 4 lần trong 30 ngày + 1 lần CŨ (ngoài 30 ngày) -> CHƯA đủ 5 (không thưởng)", async () => {
    await spend(occId, 100_000, "2026-05-01T10:00:00Z"); // >30 ngày trước (today 2026-07-11)
    for (let i = 0; i < 4; i++) await spend(occId, 100_000); // 4 lần gần đây
    await updateChallengesForMember(pool, occId);
    // VISITS: chỉ 4 trong cửa sổ 30 ngày < 5 -> KHÔNG thưởng (lần cũ không tính)
    const prog = await getMemberProgress(pool, occId);
    const vis = prog.find((p) => p.challengeCode === "VISIT_5_MONTH");
    expect(vis!.completedAt).toBeNull();
    expect((await getBalance(pool, occId)).available).toBe(0);
    await spend(occId, 100_000); // lần thứ 5 trong cửa sổ
    await updateChallengesForMember(pool, occId);
    expect((await getMemberProgress(pool, occId)).find((p) => p.challengeCode === "VISIT_5_MONTH")!.completedAt).not.toBeNull();
  });

  it("idempotent: gọi lại khi CHƯA có giao dịch mới -> không thưởng trùng", async () => {
    for (let i = 0; i < 5; i++) await spend(occId, 300_000); // 1.5M + 5 visits -> cả 2 challenge
    await updateChallengesForMember(pool, occId);
    const bal1 = (await getBalance(pool, occId)).available;
    await updateChallengesForMember(pool, occId); // gọi lại
    expect((await getBalance(pool, occId)).available).toBe(bal1); // không cộng trùng
  });
});

describe("L6 — referral 2 chiều", () => {
  it("referee dùng mã + có giao dịch -> thưởng CẢ HAI bên 300đ; idempotent", async () => {
    const code = await createReferralCode(pool, occId);
    expect(code).toMatch(/^R/);
    await joinReferral(pool, code, occB);
    // chưa có giao dịch -> chưa thưởng
    expect(await processReferralReward(pool, occB)).toBe(0);
    await spend(occB, 100_000);
    const g = await processReferralReward(pool, occB);
    expect(g).toBe(600); // 300 x 2
    expect((await getBalance(pool, occId)).available).toBe(300); // referrer
    expect((await getBalance(pool, occB)).available).toBe(300);  // referee
    // idempotent
    expect(await processReferralReward(pool, occB)).toBe(0);
    expect((await getBalance(pool, occId)).available).toBe(300);
  });

  it("chống farming: giao dịch TRƯỚC khi join -> không thưởng; sau join mới thưởng", async () => {
    await spend(occB, 100_000, "2026-06-01T10:00:00Z"); // giao dịch CŨ trước khi join
    const code = await createReferralCode(pool, occId);
    await joinReferral(pool, code, occB);
    expect(await processReferralReward(pool, occB)).toBe(0); // giao dịch cũ không tính
    await spend(occB, 100_000); // giao dịch MỚI sau join (now())
    expect(await processReferralReward(pool, occB)).toBe(600);
  });

  it("không tự giới thiệu; 1 referee 1 mã", async () => {
    const code = await createReferralCode(pool, occId);
    await expect(joinReferral(pool, code, occId)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await joinReferral(pool, code, occB);
    const code2 = await createReferralCode(pool, occB); // occB tạo mã riêng
    // occ khác giới thiệu occB lần nữa -> occB đã được giới thiệu
    const occC = (await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id")).rows[0]!.occ_id;
    const codeC = await createReferralCode(pool, occC);
    await expect(joinReferral(pool, codeC, occB)).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    expect(code2).toMatch(/^R/);
  });
});

describe("L6 — quà sinh nhật", () => {
  it("khách sinh nhật HÔM NAY (giờ VN) -> thưởng 500đ, 1 lần/năm", async () => {
    // đặt profile birth_date trùng ngày/tháng hôm nay
    await pool.query(
      `INSERT INTO cdp.profile (occ_id, birth_date) VALUES ($1, (make_date(1990, extract(month FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int, extract(day FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int)))`,
      [occId]);
    const g = await grantBirthdayBonus(pool);
    expect(g).toBeGreaterThanOrEqual(500);
    expect((await getBalance(pool, occId)).available).toBe(500);
    // chạy lại trong năm -> không thưởng trùng
    await grantBirthdayBonus(pool);
    expect((await getBalance(pool, occId)).available).toBe(500);
  });
});
