import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { earn, adjust, convert, transfer, listWallets, getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";

let occId: string;
let occB: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
  const r2 = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occB = r2.rows[0]!.occ_id;
});
const wallet = (ws: Awaited<ReturnType<typeof listWallets>>, code: string) => ws.find((w) => w.currencyCode === code);

describe("L1 — convert (đổi điểm brand -> điểm chung)", () => {
  it("adjust seed điểm brand rồi convert 1:1 sang group; ví cập nhật đúng", async () => {
    await adjust(pool, { occId, points: 100, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    const r = await convert(pool, { occId, fromCurrency: "GIVRAL_PT", toCurrency: "OCC_POINT", points: 100, idempotencyKey: "cv1" });
    expect(r.toPoints).toBe(100);
    const ws = await listWallets(pool, occId);
    expect(wallet(ws, "OCC_POINT")?.available).toBe(100);
    expect(wallet(ws, "GIVRAL_PT")).toBeUndefined(); // đã về 0 -> không liệt kê
  });

  it("convert vượt số dư -> INSUFFICIENT_BALANCE, không đổi", async () => {
    await adjust(pool, { occId, points: 50, currency: "GIVRAL_PT", idempotencyKey: "a2", reason: "seed" });
    await expect(convert(pool, { occId, fromCurrency: "GIVRAL_PT", toCurrency: "OCC_POINT", points: 200, idempotencyKey: "cv2" }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });

  it("tỷ giá 0.5 -> floor; loại điểm không tồn tại / chưa cấu hình tỷ giá -> lỗi rõ", async () => {
    // đặt tỷ giá STARCITY_PT -> OCC_POINT = 0.5 (chỉ ảnh hưởng test này)
    await pool.query(
      `UPDATE cdp.point_conversion SET rate=0.5
        WHERE from_currency_id=(SELECT id FROM cdp.point_currency WHERE code='STARCITY_NHA_TRANG_PT')
          AND to_currency_id=(SELECT id FROM cdp.point_currency WHERE code='OCC_POINT')`);
    await adjust(pool, { occId, points: 3, currency: "STARCITY_NHA_TRANG_PT", idempotencyKey: "a3", reason: "seed" });
    const r = await convert(pool, { occId, fromCurrency: "STARCITY_NHA_TRANG_PT", toCurrency: "OCC_POINT", points: 3, idempotencyKey: "cv3" });
    expect(r.toPoints).toBe(1); // floor(1.5)
    await expect(convert(pool, { occId, fromCurrency: "NOPE", toCurrency: "OCC_POINT", points: 1, idempotencyKey: "cvx" }))
      .rejects.toMatchObject({ code: "CURRENCY_NOT_FOUND" });
    // reverse group->brand chưa cấu hình
    await expect(convert(pool, { occId, fromCurrency: "OCC_POINT", toCurrency: "GIVRAL_PT", points: 1, idempotencyKey: "cvy" }))
      .rejects.toMatchObject({ code: "CONVERSION_NOT_FOUND" });
  });
});

describe("L1 — adjust (điều chỉnh thủ công có audit)", () => {
  it("adjust + rồi - ; số dư đúng; audit lý do lưu", async () => {
    await adjust(pool, { occId, points: 100, idempotencyKey: "aj1", reason: "bù điểm CSKH" });
    expect((await getBalance(pool, occId)).available).toBe(100);
    await adjust(pool, { occId, points: -30, idempotencyKey: "aj2", reason: "thu hồi" });
    expect((await getBalance(pool, occId)).available).toBe(70);
    const reason = await pool.query<{ reason: string }>("SELECT reason FROM cdp.loyalty_txn WHERE idempotency_key='aj1'");
    expect(reason.rows[0]!.reason).toBe("bù điểm CSKH");
  });
  it("adjust làm âm -> INSUFFICIENT_BALANCE; adjust 0 -> INVALID_AMOUNT", async () => {
    await expect(adjust(pool, { occId, points: -10, idempotencyKey: "aj3", reason: "x" }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(adjust(pool, { occId, points: 0, idempotencyKey: "aj4", reason: "x" }))
      .rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("L1 — transfer (chuyển điểm giữa 2 khách)", () => {
  it("earn A rồi chuyển A->B; số dư đảo đúng", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await transfer(pool, { fromOccId: occId, toOccId: occB, points: 30, idempotencyKey: "tf1", reason: "tặng" });
    expect((await getBalance(pool, occId)).available).toBe(70);
    expect((await getBalance(pool, occB)).available).toBe(30);
  });
  it("chuyển vượt số dư -> INSUFFICIENT_BALANCE; chuyển cho chính mình -> INVALID_AMOUNT", async () => {
    await earn(pool, { occId, points: 10, idempotencyKey: "e2" });
    await expect(transfer(pool, { fromOccId: occId, toOccId: occB, points: 50, idempotencyKey: "tf2" }))
      .rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(transfer(pool, { fromOccId: occId, toOccId: occId, points: 1, idempotencyKey: "tf3" }))
      .rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
  it("transfer idempotent: replay cùng key không chuyển trùng", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e3" });
    await transfer(pool, { fromOccId: occId, toOccId: occB, points: 40, idempotencyKey: "tf4" });
    const again = await transfer(pool, { fromOccId: occId, toOccId: occB, points: 40, idempotencyKey: "tf4" });
    expect(again.idempotent).toBe(true);
    expect((await getBalance(pool, occB)).available).toBe(40); // không thành 80
  });
});

describe("L1 — listWallets (đa ví)", () => {
  it("hiển thị mọi ví có số dư (group + brand)", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e4" });
    await adjust(pool, { occId, points: 50, currency: "FUJI_PT", idempotencyKey: "a5", reason: "seed" });
    const ws = await listWallets(pool, occId);
    expect(wallet(ws, "OCC_POINT")?.available).toBe(100);
    expect(wallet(ws, "FUJI_PT")?.available).toBe(50);
  });
});
