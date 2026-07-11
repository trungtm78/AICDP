import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { adjust, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import { setEarnRule } from "./earn-rule.service.js";
import { issueCard, resolveByCard, blockCard, topUp, payWithStoredValue, storedValueBalance } from "./card.service.js";

let occId: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  occId = (await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id")).rows[0]!.occ_id;
});

describe("L8 — member card (POS resolve)", () => {
  it("phát thẻ -> resolve theo card_no & qr_token; phát lại trả thẻ cũ", async () => {
    const card = await issueCard(pool, occId);
    expect(card.cardNo).toMatch(/^C/);
    expect(card.qrToken.length).toBeGreaterThan(10);
    expect((await resolveByCard(pool, card.cardNo))!.occId).toBe(occId);
    expect((await resolveByCard(pool, card.qrToken))!.occId).toBe(occId);
    const again = await issueCard(pool, occId);
    expect(again.id).toBe(card.id); // không phát trùng
  });

  it("khóa thẻ -> không resolve được", async () => {
    const card = await issueCard(pool, occId);
    await blockCard(pool, card.cardNo, "lost");
    expect(await resolveByCard(pool, card.cardNo)).toBeNull();
  });
});

describe("L8 — stored-value wallet (nạp/tiêu)", () => {
  it("nạp 100k -> số dư 100k; tiêu 30k -> 70k; idempotent", async () => {
    const t = await topUp(pool, occId, 100000, "tu1");
    expect(t.balance).toBe(100000);
    const p = await payWithStoredValue(pool, occId, 30000, "pay1");
    expect(p.balance).toBe(70000);
    expect(await storedValueBalance(pool, occId)).toBe(70000);
    // idempotent nạp
    const t2 = await topUp(pool, occId, 100000, "tu1");
    expect(t2.idempotent).toBe(true);
    expect(await storedValueBalance(pool, occId)).toBe(70000); // không nạp trùng
  });

  it("tiêu quá số dư -> INSUFFICIENT_BALANCE, không trừ", async () => {
    await topUp(pool, occId, 50000, "tu1");
    await expect(payWithStoredValue(pool, occId, 80000, "pay1")).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    expect(await storedValueBalance(pool, occId)).toBe(50000);
  });

  it("số tiền không hợp lệ -> INVALID_AMOUNT", async () => {
    await expect(topUp(pool, occId, -5, "tu1")).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
    await expect(payWithStoredValue(pool, occId, 0, "pay1")).rejects.toMatchObject({ code: "INVALID_AMOUNT" });
  });

  it("GUARD: OCC_CASH (tiền) KHÔNG dùng được cho thao tác điểm (adjust/earn-rule)", async () => {
    await expect(adjust(pool, { occId, points: 100, currency: "OCC_CASH", idempotencyKey: "a1", reason: "x" }))
      .rejects.toMatchObject({ code: "CURRENCY_NOT_FOUND" });
    await expect(setEarnRule(pool, { ruleKey: "bad", name: "x", currencyCode: "OCC_CASH", ratePerUnit: 0.001 }, "admin"))
      .rejects.toMatchObject({ code: "INVALID_RULE" });
  });
});
