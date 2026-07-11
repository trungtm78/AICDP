import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import {
  earn, reserve, release, convert, adjust, transfer, getBalance,
  expireLots, _resetLoyaltyCurrencyCache,
} from "./loyalty.service.js";

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

interface LotRow { lot_id: string; rem: number; status: string; expire_at: string | null; }
async function getLots(occ: string, code?: string): Promise<LotRow[]> {
  const r = await pool.query<{ lot_id: string; rem: string; status: string; expire_at: string | null }>(
    `SELECT l.lot_id, l.points_remaining::text AS rem, l.status, l.expire_at
       FROM cdp.loyalty_lot l JOIN cdp.point_currency c ON c.id=l.currency_id
      WHERE l.occ_id=$1 AND ($2::text IS NULL OR c.code=$2)
      ORDER BY l.expire_at ASC NULLS LAST, l.created_at ASC`,
    [occ, code ?? null],
  );
  return r.rows.map((x) => ({ lot_id: x.lot_id, rem: Number(x.rem), status: x.status, expire_at: x.expire_at }));
}
async function activeRemaining(occ: string, code?: string): Promise<number> {
  return (await getLots(occ, code)).filter((l) => l.status === "active").reduce((s, l) => s + l.rem, 0);
}
async function breakage(code = "OCC_POINT"): Promise<number> {
  const r = await pool.query<{ b: string }>(
    `SELECT COALESCE(sum(e.delta),0)::bigint::text AS b FROM cdp.loyalty_entry e
       JOIN cdp.point_currency c ON c.id=e.currency_id
      WHERE e.account='system:breakage' AND c.code=$1`, [code]);
  return Number(r.rows[0]!.b);
}

describe("L2 — earn tạo lô điểm", () => {
  it("earn tạo 1 lô active, points_remaining = points, có expire_at theo policy", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    const lots = await getLots(occId);
    expect(lots.length).toBe(1);
    expect(lots[0]!.rem).toBe(100);
    expect(lots[0]!.status).toBe("active");
    expect(lots[0]!.expire_at).not.toBeNull(); // policy ROLLING mặc định
    expect(await activeRemaining(occId)).toBe((await getBalance(pool, occId)).available);
  });
});

describe("L2 — consume FIFO theo expire_at", () => {
  it("reserve tiêu lô hết hạn SỚM trước (không phải theo thứ tự tạo)", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await earn(pool, { occId, points: 100, idempotencyKey: "e2" });
    const lots = await getLots(occId);
    // lô tạo trước cho hết hạn XA, lô tạo sau cho hết hạn GẦN -> FIFO phải tiêu lô GẦN trước.
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()+interval '100 days' WHERE lot_id=$1", [lots[0]!.lot_id]);
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()+interval '10 days' WHERE lot_id=$1", [lots[1]!.lot_id]);
    await reserve(pool, { occId, points: 120, idempotencyKey: "r1" });
    const far = (await getLots(occId)).find((l) => l.lot_id === lots[0]!.lot_id)!;
    const near = (await getLots(occId)).find((l) => l.lot_id === lots[1]!.lot_id)!;
    expect(near.rem).toBe(0);
    expect(near.status).toBe("exhausted");
    expect(far.rem).toBe(80);
    expect(far.status).toBe("active");
    expect(await activeRemaining(occId)).toBe((await getBalance(pool, occId)).available); // 80
  });

  it("release tạo lô mới (available tăng); capture không đụng lô", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    const rr = await reserve(pool, { occId, points: 60, idempotencyKey: "r1" });
    expect(await activeRemaining(occId)).toBe(40);
    await release(pool, { reservationId: rr.reservationId, idempotencyKey: "rel1" });
    expect(await activeRemaining(occId)).toBe(100); // 40 cũ + lô mới 60
    expect((await getBalance(pool, occId)).available).toBe(100);
  });
});

describe("L2 — convert/adjust/transfer đồng bộ lô", () => {
  it("adjust + tạo lô; adjust - tiêu FIFO; invariant giữ", async () => {
    await adjust(pool, { occId, points: 100, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    expect(await activeRemaining(occId, "GIVRAL_PT")).toBe(100);
    await adjust(pool, { occId, points: -30, currency: "GIVRAL_PT", idempotencyKey: "a2", reason: "thu hồi" });
    expect(await activeRemaining(occId, "GIVRAL_PT")).toBe(70);
  });

  it("convert: burn lô 'from' + mint lô 'to'", async () => {
    await adjust(pool, { occId, points: 100, currency: "GIVRAL_PT", idempotencyKey: "a1", reason: "seed" });
    await convert(pool, { occId, fromCurrency: "GIVRAL_PT", toCurrency: "OCC_POINT", points: 100, idempotencyKey: "cv1" });
    expect(await activeRemaining(occId, "GIVRAL_PT")).toBe(0);
    expect(await activeRemaining(occId, "OCC_POINT")).toBe(100);
  });

  it("transfer: tiêu lô người gửi, tạo lô người nhận", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await transfer(pool, { fromOccId: occId, toOccId: occB, points: 30, idempotencyKey: "tf1", reason: "tặng" });
    expect(await activeRemaining(occId)).toBe(70);
    expect(await activeRemaining(occB)).toBe(30);
  });
});

describe("L2 — expiry + breakage", () => {
  it("lô quá hạn -> breakage (available giảm, system:breakage tăng), lô status=expired, idempotent", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    const n = await expireLots(pool);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await getBalance(pool, occId)).available).toBe(0);
    expect(await breakage()).toBe(100);
    expect((await getLots(occId))[0]!.status).toBe("expired");
    // idempotent: chạy lại không hạch toán trùng
    await expireLots(pool);
    expect(await breakage()).toBe(100);
  });

  it("chỉ hết hạn phần AVAILABLE; điểm đã reserved không bị breakage", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await reserve(pool, { occId, points: 40, idempotencyKey: "r1" }); // lô còn 60 available, 40 reserved
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()-interval '1 day' WHERE occ_id=$1", [occId]);
    await expireLots(pool);
    const bal = await getBalance(pool, occId);
    expect(bal.available).toBe(0);
    expect(bal.reserved).toBe(40); // reserved nguyên vẹn
    expect(await breakage()).toBe(60);
  });

  it("lô chưa tới hạn không bị đụng", async () => {
    await earn(pool, { occId, points: 50, idempotencyKey: "e1" }); // expire_at tương lai (policy)
    await expireLots(pool);
    expect((await getBalance(pool, occId)).available).toBe(50);
    expect(await breakage()).toBe(0);
  });
});

describe("L2 — BẢO TOÀN expire_at (chống điểm bất tử)", () => {
  it("reserve->release KHÔNG reset đồng hồ: lô trả lại giữ expire_at gốc -> vẫn breakage khi tới hạn", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    // Đặt hạn lô = hôm qua? Không — đặt hạn NGÀY MAI, reserve rồi release, kiểm expire_at KHÔNG bị đẩy 24 tháng.
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()+interval '1 day' WHERE occ_id=$1", [occId]);
    const orig = (await getLots(occId))[0]!.expire_at;
    const rr = await reserve(pool, { occId, points: 100, idempotencyKey: "r1" });
    await release(pool, { reservationId: rr.reservationId, idempotencyKey: "rel1" });
    const after = (await getLots(occId)).filter((l) => l.status === "active");
    expect(after.length).toBe(1);
    // expire_at bảo toàn (trong vài giây) — KHÔNG nhảy sang +24 tháng.
    expect(Math.abs(new Date(after[0]!.expire_at!).getTime() - new Date(orig!).getTime())).toBeLessThan(5000);
  });

  it("transfer bảo toàn expire_at người nhận: điểm sắp hết hạn chuyển đi vẫn breakage đúng hạn", async () => {
    await earn(pool, { occId, points: 100, idempotencyKey: "e1" });
    await pool.query("UPDATE cdp.loyalty_lot SET expire_at=now()-interval '1 second' WHERE occ_id=$1", [occId]);
    // chuyển sang B: lô B phải thừa hưởng hạn đã quá -> expireLots breakage ngay ở B (không gia hạn).
    await transfer(pool, { fromOccId: occId, toOccId: occB, points: 100, idempotencyKey: "tf1", reason: "x" });
    const n = await expireLots(pool);
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await getBalance(pool, occB)).available).toBe(0);
    expect(await breakage()).toBe(100);
  });
});

describe("L2 — backfill lô cho số dư available cũ (migration 026)", () => {
  const BACKFILL_SQL = `
    INSERT INTO cdp.loyalty_lot (occ_id, currency_id, points_original, points_remaining, expire_at)
    SELECT s.occ_id, s.currency_id, s.bal, s.bal,
           (SELECT CASE p.mode WHEN 'NONE' THEN NULL
                     WHEN 'ROLLING' THEN now() + (p.duration_months || ' months')::interval
                     WHEN 'FIXED' THEN date_trunc('year', now() + (p.duration_months || ' months')::interval) + interval '1 year' - interval '1 second'
                   END FROM cdp.expiration_policy p WHERE p.currency_id = s.currency_id AND p.is_active)
    FROM (
      SELECT (substring(account from 'member:(.*):available'))::uuid AS occ_id, currency_id, sum(delta) AS bal
        FROM cdp.loyalty_entry WHERE account LIKE 'member:%:available'
        GROUP BY 1, currency_id HAVING sum(delta) > 0
    ) s
    WHERE NOT EXISTS (SELECT 1 FROM cdp.loyalty_lot l WHERE l.occ_id=s.occ_id AND l.currency_id=s.currency_id AND l.status='active');`;

  it("số dư available KHÔNG có lô (dữ liệu tiền-L2) -> backfill tạo lô đúng số; reserve chạy được", async () => {
    // Mô phỏng điểm kernel cũ: post entry available trực tiếp, KHÔNG tạo lô.
    const gid = (await pool.query<{ id: string }>("SELECT id FROM cdp.point_currency WHERE code='OCC_POINT'")).rows[0]!.id;
    const t = await pool.query<{ txn_id: string }>(
      "INSERT INTO cdp.loyalty_txn (idempotency_key, type, occ_id, fingerprint) VALUES ('old1','earn',$1,'old1') RETURNING txn_id", [occId]);
    await pool.query(
      "INSERT INTO cdp.loyalty_entry (txn_id, account, delta, currency_id) VALUES ($1,$2,200,$3),($1,'system:issued',-200,$3)",
      [t.rows[0]!.txn_id, `member:${occId}:available`, gid]);
    expect(await activeRemaining(occId)).toBe(0); // chưa có lô
    expect((await getBalance(pool, occId)).available).toBe(200);
    // reserve LÚC NÀY phải fail (bất biến vỡ) — chứng minh vì sao cần backfill.
    await expect(reserve(pool, { occId, points: 50, idempotencyKey: "r1" })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    // Chạy backfill.
    await pool.query(BACKFILL_SQL);
    expect(await activeRemaining(occId)).toBe(200);
    expect((await getLots(occId))[0]!.expire_at).not.toBeNull();
    // reserve giờ chạy được.
    const rr = await reserve(pool, { occId, points: 50, idempotencyKey: "r2" });
    expect(rr.balance.available).toBe(150);
    // Idempotent: chạy lại backfill KHÔNG nhân đôi lô.
    await pool.query(BACKFILL_SQL);
    expect(await activeRemaining(occId)).toBe(150); // 200 - 50 reserved, không thành 350
  });
});
