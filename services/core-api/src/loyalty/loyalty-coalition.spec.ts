import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { earn, reserve, capture, getBalance, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";

// L0 — nền coalition: company + point_currency + conversion + ledger currency_id + trigger per-currency.

let occId: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
});

async function currencyId(code: string): Promise<string> {
  const r = await pool.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code=$1", [code]);
  return r.rows[0]!.id;
}

describe("L0 — schema pháp nhân + đa point-currency", () => {
  it("company seed 2 pháp nhân + brand.company_id map đúng (F&B vs khách sạn)", async () => {
    const c = await pool.query<{ n: string }>("SELECT count(*)::text n FROM cdp.company");
    expect(Number(c.rows[0]!.n)).toBeGreaterThanOrEqual(2);
    const givral = await pool.query<{ code: string }>(
      "SELECT co.code FROM cdp.brand b JOIN cdp.company co ON co.id=b.company_id WHERE b.brand_id='givral'");
    expect(givral.rows[0]!.code).toBe("occ_fnb");
    const dusit = await pool.query<{ code: string }>(
      "SELECT co.code FROM cdp.brand b JOIN cdp.company co ON co.id=b.company_id WHERE b.brand_id='dusit_hanoi'");
    expect(dusit.rows[0]!.code).toBe("occ_hotel");
  });

  it("point_currency: 1 GROUP + mỗi brand 1 BRAND; conversion brand->group 1:1", async () => {
    const g = await pool.query<{ n: string }>("SELECT count(*)::text n FROM cdp.point_currency WHERE kind='GROUP'");
    expect(Number(g.rows[0]!.n)).toBe(1);
    const b = await pool.query<{ n: string }>("SELECT count(*)::text n FROM cdp.point_currency WHERE kind='BRAND'");
    expect(Number(b.rows[0]!.n)).toBeGreaterThanOrEqual(6);
    const conv = await pool.query<{ rate: string }>(
      `SELECT pc.rate::text rate FROM cdp.point_conversion pc
         JOIN cdp.point_currency f ON f.id=pc.from_currency_id
         JOIN cdp.point_currency t ON t.id=pc.to_currency_id
        WHERE f.code='GIVRAL_PT' AND t.code='OCC_POINT'`);
    expect(Number(conv.rows[0]!.rate)).toBe(1);
  });
});

describe("L0 — kernel currency-aware (GROUP mặc định, tương thích ngược)", () => {
  it("earn ghi entry vào GROUP currency; balance đúng", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "k1" });
    const bal = await getBalance(pool, occId);
    expect(bal.available).toBe(100);
    const grp = await currencyId("OCC_POINT");
    const e = await pool.query<{ n: string }>(
      "SELECT count(*)::int n FROM cdp.loyalty_entry WHERE currency_id=$1", [grp]);
    expect(Number(e.rows[0]!.n)).toBe(2); // +available, -issued đều group
    const nullc = await pool.query<{ n: string }>("SELECT count(*)::int n FROM cdp.loyalty_entry WHERE currency_id IS NULL");
    expect(Number(nullc.rows[0]!.n)).toBe(0);
  });

  it("regression earn->reserve->capture vẫn đúng", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    const rv = await reserve(pool, { occId, points: 30, idempotencyKey: "r1" });
    expect(rv.balance.available).toBe(70);
    expect(rv.balance.reserved).toBe(30);
    const cap = await capture(pool, { reservationId: rv.reservationId, idempotencyKey: "c1" });
    expect(cap.balance.available).toBe(70);
    expect(cap.balance.reserved).toBe(0);
  });
});

describe("L0 — trigger cân bằng PER (txn, currency)", () => {
  it("txn 2 currency mỗi cái cân -> OK", async () => {
    const grp = await currencyId("OCC_POINT");
    const brand = await currencyId("GIVRAL_PT");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const t = await client.query<{ txn_id: string }>(
        "INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id) VALUES ('m1','convert',$1) RETURNING txn_id", [occId]);
      const tx = t.rows[0]!.txn_id;
      for (const [acc, d, c] of [["x", 5, grp], ["y", -5, grp], ["a", 3, brand], ["b", -3, brand]] as const) {
        await client.query("INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,$3,$4)", [tx, acc, d, c]);
      }
      await client.query("COMMIT");
    } finally { client.release(); }
    const ok = await pool.query<{ n: string }>("SELECT count(*)::int n FROM cdp.loyalty_txn WHERE idempotency_key='m1'");
    expect(Number(ok.rows[0]!.n)).toBe(1);
  });

  it("txn 1 currency KHÔNG cân -> DB chặn ở COMMIT", async () => {
    const grp = await currencyId("OCC_POINT");
    const brand = await currencyId("GIVRAL_PT");
    const client = await pool.connect();
    let threw = false;
    try {
      await client.query("BEGIN");
      const t = await client.query<{ txn_id: string }>(
        "INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id) VALUES ('m2','convert',$1) RETURNING txn_id", [occId]);
      const tx = t.rows[0]!.txn_id;
      // group cân, nhưng brand lệch (+3 không có -3)
      for (const [acc, d, c] of [["x", 5, grp], ["y", -5, grp], ["a", 3, brand]] as const) {
        await client.query("INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,$3,$4)", [tx, acc, d, c]);
      }
      await client.query("COMMIT");
    } catch {
      threw = true;
      await client.query("ROLLBACK").catch(() => undefined);
    } finally { client.release(); }
    expect(threw).toBe(true);
  });
});
