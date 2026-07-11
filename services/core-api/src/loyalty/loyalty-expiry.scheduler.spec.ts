import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { earn, getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import { LoyaltyExpiryScheduler } from "./loyalty-expiry.scheduler.js";

let occId: string;
let sched: LoyaltyExpiryScheduler;
beforeAll(async () => {
  await setupTestDb();
  _resetLoyaltyCurrencyCache();
  sched = new LoyaltyExpiryScheduler(pool);
});
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
});

describe("LoyaltyExpiryScheduler.runOnce", () => {
  it("đáo hạn lô quá hạn -> breakage, trả số lô xử lý", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    const n = await sched.runOnce();
    expect(n).toBe(1);
    expect((await getBalance(pool, occId)).available).toBe(0);
  });

  it("không có lô tới hạn -> trả 0 (idempotent, an toàn khi chạy nền)", async () => {
    await earn(pool, { occId, points: 50, idempotencyKey: "e1" }); // hạn tương lai
    expect(await sched.runOnce()).toBe(0);
    expect((await getBalance(pool, occId)).available).toBe(50);
  });

  it("single-flight: lượt thứ 2 khi lượt đầu chưa xong -> 0 (không chồng)", async () => {
    await earn(pool, { occId, points: 10, idempotencyKey: "e1" });
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    const p1 = sched.runOnce();
    const p2 = sched.runOnce(); // đang chạy -> resolve 0 ngay
    const [n1, n2] = await Promise.all([p1, p2]);
    expect(n1).toBe(1);
    expect(n2).toBe(0);
  });
});
