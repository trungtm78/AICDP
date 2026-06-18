import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import {
  earn,
  reserve,
  capture,
  release,
  getBalance,
  LoyaltyError,
} from "./loyalty.service.js";

let occId: string;

beforeAll(async () => {
  await setupTestDb();
});

beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>(
    "INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id",
  );
  occId = r.rows[0]!.occ_id;
});

async function txnSumsZero(): Promise<boolean> {
  // Bất biến double-entry: mỗi txn có tổng delta = 0.
  const r = await pool.query<{ bad: string }>(
    `SELECT count(*)::int AS bad FROM (
       SELECT txn_id, sum(delta) AS s FROM cdp.loyalty_entry GROUP BY txn_id
     ) t WHERE s <> 0`,
  );
  return Number(r.rows[0]!.bad) === 0;
}

describe("loyalty — earn", () => {
  it("earn cộng vào available; balance là projection", async () => {
    const res = await earn(pool, { occId, points: 100, idempotencyKey: "k-earn-1" });
    expect(res.balance.available).toBe(100);
    expect(res.balance.reserved).toBe(0);
    expect(await txnSumsZero()).toBe(true);
  });

  it("earn idempotent: replay cùng key KHÔNG cộng trùng", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "k-earn-2" });
    const again = await earn(pool, { occId, points: 100, idempotencyKey: "k-earn-2" });
    expect(again.idempotent).toBe(true);
    expect(again.balance.available).toBe(100); // không thành 200
    const bal = await getBalance(pool, occId);
    expect(bal.available).toBe(100);
  });

  it("earn số điểm <= 0 -> LoyaltyError INVALID_AMOUNT", async () => {
    await expect(
      earn(pool, { occId, points: 0, idempotencyKey: "k-earn-z" }),
    ).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });
});

describe("loyalty — reserve/capture/release", () => {
  beforeEach(async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: `seed-${occId}` });
  });

  it("reserve chuyển available -> reserved và trả reservationId", async () => {
    const r = await reserve(pool, { occId, points: 30, idempotencyKey: "k-res-1" });
    expect(r.balance.available).toBe(70);
    expect(r.balance.reserved).toBe(30);
    expect(r.reservationId).toBeTruthy();
    expect(await txnSumsZero()).toBe(true);
  });

  it("capture theo reservationId giảm reserved (đã tiêu điểm)", async () => {
    const r = await reserve(pool, { occId, points: 30, idempotencyKey: "k-res-2" });
    const c = await capture(pool, { reservationId: r.reservationId, idempotencyKey: "k-cap-2" });
    expect(c.balance.reserved).toBe(0);
    expect(c.balance.available).toBe(70);
  });

  it("release theo reservationId trả reserved về available", async () => {
    const r = await reserve(pool, { occId, points: 30, idempotencyKey: "k-res-3" });
    const rel = await release(pool, { reservationId: r.reservationId, idempotencyKey: "k-rel-3" });
    expect(rel.balance.available).toBe(100);
    expect(rel.balance.reserved).toBe(0);
  });

  it("CẤM ÂM: reserve quá available -> INSUFFICIENT_BALANCE, balance không đổi", async () => {
    await expect(
      reserve(pool, { occId, points: 150, idempotencyKey: "k-res-over" }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    const bal = await getBalance(pool, occId);
    expect(bal.available).toBe(100);
    expect(bal.reserved).toBe(0);
  });

  it("capture lại reservation đã capture (key mới) -> RESERVATION_INVALID_STATE", async () => {
    const r = await reserve(pool, { occId, points: 20, idempotencyKey: "k-res-4" });
    await capture(pool, { reservationId: r.reservationId, idempotencyKey: "k-cap-4a" });
    await expect(
      capture(pool, { reservationId: r.reservationId, idempotencyKey: "k-cap-4b" }),
    ).rejects.toMatchObject({ code: "RESERVATION_INVALID_STATE" });
  });

  it("capture reservationId không tồn tại -> RESERVATION_NOT_FOUND", async () => {
    await expect(
      capture(pool, {
        reservationId: "00000000-0000-0000-0000-000000000000",
        idempotencyKey: "k-cap-x",
      }),
    ).rejects.toMatchObject({ code: "RESERVATION_NOT_FOUND" });
  });

  it("hai reservation song song: capture cái này KHÔNG đụng cái kia", async () => {
    const a = await reserve(pool, { occId, points: 40, idempotencyKey: "iso-a" });
    const b = await reserve(pool, { occId, points: 30, idempotencyKey: "iso-b" });
    // reserved = 70, available = 30
    await capture(pool, { reservationId: a.reservationId, idempotencyKey: "iso-cap-a" });
    const bal = await getBalance(pool, occId);
    expect(bal.reserved).toBe(30); // chỉ còn reservation b
    // b vẫn release được độc lập
    const rel = await release(pool, { reservationId: b.reservationId, idempotencyKey: "iso-rel-b" });
    expect(rel.balance.reserved).toBe(0);
    expect(rel.balance.available).toBe(60); // 30 + 30 trả lại
  });

  it("idempotency fingerprint: dùng lại key cho tham số khác -> IDEMPOTENCY_CONFLICT", async () => {
    await earn(pool, { occId, points: 10, idempotencyKey: "dup-key" });
    await expect(
      earn(pool, { occId, points: 999, idempotencyKey: "dup-key" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
});

describe("loyalty — concurrency (cấm double-spend)", () => {
  it("hai reserve đồng thời tổng > available: chỉ một thành công, available không âm", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "k-conc-earn" });
    const results = await Promise.allSettled([
      reserve(pool, { occId, points: 80, idempotencyKey: "k-conc-a" }),
      reserve(pool, { occId, points: 80, idempotencyKey: "k-conc-b" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok.length).toBe(1);
    expect(failed.length).toBe(1);
    const bal = await getBalance(pool, occId);
    expect(bal.available).toBeGreaterThanOrEqual(0);
    expect(bal.available).toBe(20);
    expect(bal.reserved).toBe(80);
    expect(failed[0]!.status === "rejected" && (failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      LoyaltyError,
    );
  });
});
