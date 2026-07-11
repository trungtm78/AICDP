import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { adjust, earn, reserve, convert, getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import { redeemReward } from "./reward.service.js";
import { setPointPrice, computeLiabilitySnapshot, getLatestLiability, getSettlementReport } from "./liability.service.js";

let occId: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  occId = (await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id")).rows[0]!.occ_id;
});

describe("L7 — liability snapshot IFRS15 (theo pháp nhân phát hành)", () => {
  it("điểm brand GIVRAL_PT (cty occ_fnb): outstanding × unit × (1-breakage) = deferred revenue", async () => {
    await setPointPrice(pool, { currencyCode: "GIVRAL_PT", pricePerPoint: 500, breakageRate: 0.1 });
    await adjust(pool, { occId, points: 1000, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    const rows = await computeLiabilitySnapshot(pool);
    const g = rows.find((r) => r.currencyCode === "GIVRAL_PT")!;
    expect(g.companyCode).toBe("occ_fnb");
    expect(g.outstandingPoints).toBe(1000);
    expect(g.unitValue).toBe(500);
    expect(g.grossLiability).toBe(500000);
    expect(g.deferredRevenue).toBe(450000); // 500000 × 0.9
    expect(g.breakageRevenue).toBe(50000);  // 500000 × 0.1
    // getLatest phản ánh snapshot vừa chốt
    const latest = await getLatestLiability(pool);
    expect(latest.find((r) => r.currencyCode === "GIVRAL_PT")!.deferredRevenue).toBe(450000);
  });

  it("outstanding giảm sau khi tiêu điểm -> liability giảm", async () => {
    await setPointPrice(pool, { currencyCode: "GIVRAL_PT", pricePerPoint: 1000, breakageRate: 0 });
    await adjust(pool, { occId, points: 1000, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    await adjust(pool, { occId, points: -400, currency: "GIVRAL_PT", idempotencyKey: "a2", reason: "tiêu" });
    const rows = await computeLiabilitySnapshot(pool);
    expect(rows.find((r) => r.currencyCode === "GIVRAL_PT")!.outstandingPoints).toBe(600);
    expect(rows.find((r) => r.currencyCode === "GIVRAL_PT")!.grossLiability).toBe(600000);
  });
});

describe("L7 — inter-company settlement (credit-in-arrears)", () => {
  it("điểm cty occ_fnb tiêu ở brand cty occ_hotel -> occ_fnb bù occ_hotel (points × unit)", async () => {
    await setPointPrice(pool, { currencyCode: "GIVRAL_PT", pricePerPoint: 500 });
    await adjust(pool, { occId, points: 1000, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    // reward VOUCHER cost 500 GIVRAL_PT, đổi tại brand sunrise_nha_trang (occ_hotel)
    const cur = (await pool.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='GIVRAL_PT'")).rows[0]!.id;
    await pool.query(
      `INSERT INTO cdp.reward_catalog_item (code, name, type, cost_points, currency_id, value_type, value, redeemable_at_brand_id)
       VALUES ('RW_HOTEL','Voucher đổi tại hotel','VOUCHER',500,$1,'FIXED',50000,'sunrise_nha_trang') ON CONFLICT (code) DO NOTHING`, [cur]);
    const rd = await redeemReward(pool, { occId, rewardCode: "RW_HOTEL", idempotencyKey: "rd1" });
    expect(rd.costPoints).toBe(500);
    // settlement kỳ hiện tại
    const period = (await pool.query<{ p: string }>("SELECT to_char(now(),'YYYY-MM') AS p")).rows[0]!.p;
    const rep = await getSettlementReport(pool, period);
    const row = rep.find((r) => r.fromCompany === "occ_fnb" && r.toCompany === "occ_hotel");
    expect(row).toBeTruthy();
    expect(row!.points).toBe(500);
    expect(row!.amount).toBe(250000); // 500 × 500
  });

  it("điểm RESERVED vẫn tính vào liability (không understate nghĩa vụ)", async () => {
    // OCC_POINT đã seed point_price (1000đ, breakage 0.2)
    await earn(pool, { occId, points: 1000, idempotencyKey: "e1" }); // group, issuing NULL
    await reserve(pool, { occId, points: 400, idempotencyKey: "r1" }); // 600 available + 400 reserved
    const rows = await computeLiabilitySnapshot(pool);
    const g = rows.find((r) => r.currencyCode === "OCC_POINT" && r.companyId === null)!;
    expect(g.outstandingPoints).toBe(1000); // gồm cả reserved (không phải 600)
  });

  it("convert brand->group GIỮ attribution issuing company -> settlement coalition đúng", async () => {
    await setPointPrice(pool, { currencyCode: "GIVRAL_PT", pricePerPoint: 500 });
    await adjust(pool, { occId, points: 1000, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    await convert(pool, { occId, fromCurrency: "GIVRAL_PT", toCurrency: "OCC_POINT", points: 1000, idempotencyKey: "cv1" });
    // Lô OCC_POINT vừa mint phải giữ issuing occ_fnb (không NULL)
    const liab = await computeLiabilitySnapshot(pool);
    const grp = liab.find((r) => r.currencyCode === "OCC_POINT" && r.companyCode === "occ_fnb");
    expect(grp).toBeTruthy();
    expect(grp!.outstandingPoints).toBe(1000);
    // Redeem OCC_POINT tại brand hotel -> settlement occ_fnb -> occ_hotel
    const gid = (await pool.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='OCC_POINT'")).rows[0]!.id;
    await pool.query(
      `INSERT INTO cdp.reward_catalog_item (code, name, type, cost_points, currency_id, value_type, value, redeemable_at_brand_id)
       VALUES ('RW_HOTEL_GRP','Voucher group đổi hotel','VOUCHER',500,$1,'FIXED',50000,'sunrise_nha_trang') ON CONFLICT (code) DO NOTHING`, [gid]);
    await redeemReward(pool, { occId, rewardCode: "RW_HOTEL_GRP", idempotencyKey: "rd1" });
    const period = (await pool.query<{ p: string }>("SELECT to_char(now(),'YYYY-MM') AS p")).rows[0]!.p;
    const rep = await getSettlementReport(pool, period);
    expect(rep.find((r) => r.fromCompany === "occ_fnb" && r.toCompany === "occ_hotel")).toBeTruthy();
  });

  it("FAIL-CLOSED: redeem cross-company khi CHƯA set point_price -> SETTLEMENT_PRICE_MISSING, rollback", async () => {
    // Đảm bảo GIVRAL_PT KHÔNG có giá (point_price không truncate giữa test -> xoá tường minh).
    await pool.query("DELETE FROM cdp.point_price WHERE currency_id=(SELECT id FROM cdp.point_currency WHERE code='GIVRAL_PT')");
    await adjust(pool, { occId, points: 1000, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    const cur = (await pool.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='GIVRAL_PT'")).rows[0]!.id;
    await pool.query(
      `INSERT INTO cdp.reward_catalog_item (code, name, type, cost_points, currency_id, value_type, value, redeemable_at_brand_id)
       VALUES ('RW_NOPRICE','x','VOUCHER',500,$1,'FIXED',50000,'sunrise_nha_trang') ON CONFLICT (code) DO NOTHING`, [cur]);
    await expect(redeemReward(pool, { occId, rewardCode: "RW_NOPRICE", idempotencyKey: "rd1" }))
      .rejects.toMatchObject({ code: "SETTLEMENT_PRICE_MISSING" });
    // rollback: điểm không bị burn
    const bal = await pool.query<{ b: string }>("SELECT COALESCE(sum(delta),0)::text AS b FROM cdp.loyalty_entry e JOIN cdp.point_currency c ON c.id=e.currency_id WHERE e.account=$1 AND c.code='GIVRAL_PT'", [`member:${occId}:available`]);
    expect(Number(bal.rows[0]!.b)).toBe(1000);
  });

  it("tiêu điểm ở CÙNG pháp nhân phát hành -> KHÔNG phát sinh settlement", async () => {
    await setPointPrice(pool, { currencyCode: "GIVRAL_PT", pricePerPoint: 500 });
    await adjust(pool, { occId, points: 1000, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    const cur = (await pool.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='GIVRAL_PT'")).rows[0]!.id;
    await pool.query(
      `INSERT INTO cdp.reward_catalog_item (code, name, type, cost_points, currency_id, value_type, value, redeemable_at_brand_id)
       VALUES ('RW_FNB','Voucher đổi tại givral','VOUCHER',500,$1,'FIXED',50000,'givral') ON CONFLICT (code) DO NOTHING`, [cur]);
    await redeemReward(pool, { occId, rewardCode: "RW_FNB", idempotencyKey: "rd1" });
    const period = (await pool.query<{ p: string }>("SELECT to_char(now(),'YYYY-MM') AS p")).rows[0]!.p;
    const rep = await getSettlementReport(pool, period);
    expect(rep.length).toBe(0); // givral & occ_fnb cùng cty -> không bù trừ
  });
});
