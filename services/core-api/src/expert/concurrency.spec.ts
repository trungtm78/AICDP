import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { earn, reserve, getBalance, LoyaltyError } from "../loyalty/loyalty.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// TẦNG CHUYÊN GIA — CONCURRENCY RACE trên Postgres thật (PF-02/03).
// Chứng minh idempotency (ON CONFLICT) + advisory lock chống oversell dưới ĐỒNG THỜI.
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

function order(overrides: Record<string, unknown> = {}) {
  return {
    brand_id: "givral",
    store_id: "givral-q1",
    source: "pos",
    occ_timestamp: "2026-06-18T10:00:00+07:00",
    identifiers: [{ type: "phone", value: "0901234567" }],
    properties: { pos_transaction_id: "RACE-1", currency: "VND", total: 250000, items: [] },
    ...overrides,
  };
}

describe("PF-02: ingest đua CÙNG {brand}:{store}:{pos_txn} -> đúng 1 canonical_transaction", () => {
  it("20 ingest song song cùng key -> 1 row, cùng occId, không nhân bản", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => ingestOrderCompleted(pool, order() as never)),
    );
    const ok = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    expect(ok.length).toBe(20); // không request nào lỗi

    // Bất biến cốt lõi: đúng 1 dòng canonical_transaction cho message_id đó.
    const cnt = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM cdp.canonical_transaction WHERE message_id=$1",
      ["givral:givral-q1:RACE-1"],
    );
    expect(Number(cnt.rows[0]!.n)).toBe(1);

    // Mọi response trả CÙNG occId (resolve race-free).
    const occIds = new Set(ok.map((r) => r.value.occId));
    expect(occIds.size).toBe(1);
    // Đúng 1 lần idempotent=false (lần tạo thật), còn lại true.
    const created = ok.filter((r) => r.value.idempotent === false).length;
    expect(created).toBe(1);
  });
});

describe("PF-03: reserve đua trên 1 occId -> KHÔNG oversell, available không âm", () => {
  it("earn 100, 10 reserve(40) song song -> tối đa 2 thành công, available>=0", async () => {
    const ing = await ingestOrderCompleted(pool, order({ properties: { pos_transaction_id: "RACE-RES", total: 1, items: [] } }) as never);
    const occId = ing.occId!;
    await earn(pool, { occId, points: 100, idempotencyKey: "race-earn" });

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => reserve(pool, { occId, points: 40, idempotencyKey: `race-res-${i}` })),
    );
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];

    // Không oversell: 100/40 -> tối đa 2 reserve thành công.
    expect(ok).toBeLessThanOrEqual(2);
    expect(ok).toBeGreaterThanOrEqual(1);
    // Các reject phải là INSUFFICIENT_BALANCE (guard đúng), không phải lỗi lạ.
    for (const r of rejected) expect((r.reason as LoyaltyError).code).toBe("INSUFFICIENT_BALANCE");

    const bal = await getBalance(pool, occId);
    expect(bal.available).toBeGreaterThanOrEqual(0); // KHÔNG âm dù đua
    expect(bal.reserved).toBe(40 * ok);
    expect(bal.available).toBe(100 - 40 * ok);
  });

  it("earn đua keys khác nhau -> tổng đúng (không lost update)", async () => {
    const ing = await ingestOrderCompleted(pool, order({ properties: { pos_transaction_id: "RACE-EARN", total: 1, items: [] } }) as never);
    const occId = ing.occId!;
    await Promise.all(Array.from({ length: 15 }, (_, i) => earn(pool, { occId, points: 10, idempotencyKey: `e-${i}` })));
    expect((await getBalance(pool, occId)).available).toBe(150);
  });
});
