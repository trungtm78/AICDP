import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { getBalance, listWallets, _resetLoyaltyCurrencyCache } from "./loyalty.service.js";
import {
  setEarnRule, listEarnRules, listEarnRuleAudit, earnForTransaction, processUnearnedTransactions,
} from "./earn-rule.service.js";

let occId: string;
beforeAll(async () => { await setupTestDb(); _resetLoyaltyCurrencyCache(); });
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
});

let seq = 0;
async function makeTxn(opts: { brand?: string; source?: string; total: number; time?: string; occ?: string | null; pm?: string }): Promise<string> {
  const mid = `msg-${++seq}-${opts.total}`;
  await pool.query(
    `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, store_id, source, pos_transaction_id, total, payment_method, occ_timestamp)
     VALUES ($1,$2,$3,'s1',$4,$5,$6,$7,$8)`,
    [mid, opts.occ === undefined ? occId : opts.occ, opts.brand ?? "givral", opts.source ?? "pos",
     `pos-${mid}`, opts.total, opts.pm ?? "cash", opts.time ?? "2026-07-08T10:00:00Z"],
  );
  return mid;
}
async function wallet(occ: string, code: string): Promise<number | undefined> {
  return (await listWallets(pool, occ)).find((w) => w.currencyCode === code)?.available;
}

describe("L3 — setEarnRule (append-only + audit)", () => {
  it("tạo version 1; ghi đè -> version 2, vô hiệu v1; chỉ 1 rule active; audit 2 dòng", async () => {
    const v1 = await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    expect(v1.version).toBe(1);
    expect(v1.isActive).toBe(true);
    const v2 = await setEarnRule(pool, { ruleKey: "base", name: "Base v2", currencyCode: "OCC_POINT", ratePerUnit: 0.002 }, "admin");
    expect(v2.version).toBe(2);
    const active = await listEarnRules(pool);
    expect(active.filter((r) => r.ruleKey === "base").length).toBe(1); // chỉ v2
    expect(active.find((r) => r.ruleKey === "base")!.ratePerUnit).toBe(0.002);
    const audit = await listEarnRuleAudit(pool, "base");
    expect(audit.length).toBe(2);
  });
});

describe("L3 — auto-earn theo rule", () => {
  it("base rule 1đ/1000: giao dịch 100.000đ -> 100 điểm group, qualifying, idempotent", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    const mid = await makeTxn({ total: 100_000 });
    const earned = await earnForTransaction(pool, mid);
    expect(earned).toBe(100);
    expect((await getBalance(pool, occId)).available).toBe(100);
    const q = await pool.query<{ qualifying: boolean }>("SELECT qualifying FROM cdp.loyalty_txn WHERE ref_message_id=$1", [mid]);
    expect(q.rows[0]!.qualifying).toBe(true);
    // idempotent: chạy lại không tích trùng
    expect(await earnForTransaction(pool, mid)).toBe(0);
    expect((await getBalance(pool, occId)).available).toBe(100);
  });

  it("rule brand-specific priority cao thắng base; tích vào currency của rule (GIVRAL_PT)", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001, priority: 0 }, "admin");
    await setEarnRule(pool, { ruleKey: "givral_x2", name: "Givral x2", currencyCode: "GIVRAL_PT", ratePerUnit: 0.001, multiplier: 2, brandId: "givral", priority: 100 }, "admin");
    const mid = await makeTxn({ brand: "givral", total: 100_000 });
    const earned = await earnForTransaction(pool, mid);
    expect(earned).toBe(200); // floor(100000*0.001*2)
    expect(await wallet(occId, "GIVRAL_PT")).toBe(200);
    expect(await wallet(occId, "OCC_POINT")).toBeUndefined(); // base không áp
  });

  it("non-qualifying rule -> loyalty_txn.qualifying=false", async () => {
    await setEarnRule(pool, { ruleKey: "promo", name: "Promo non-qual", currencyCode: "OCC_POINT", ratePerUnit: 0.001, qualifying: false }, "admin");
    const mid = await makeTxn({ total: 50_000 });
    await earnForTransaction(pool, mid);
    const q = await pool.query<{ qualifying: boolean }>("SELECT qualifying FROM cdp.loyalty_txn WHERE ref_message_id=$1", [mid]);
    expect(q.rows[0]!.qualifying).toBe(false);
  });

  it("min_amount + channel filter: dưới ngưỡng / sai kênh -> không tích (đánh dấu đã xử lý)", async () => {
    await setEarnRule(pool, { ruleKey: "web_big", name: "Web >=200k", currencyCode: "OCC_POINT", ratePerUnit: 0.001, channel: "web", minAmount: 200_000 }, "admin");
    const small = await makeTxn({ source: "web", total: 100_000 }); // dưới ngưỡng
    expect(await earnForTransaction(pool, small)).toBe(0);
    const wrongCh = await makeTxn({ source: "pos", total: 300_000 }); // sai kênh
    expect(await earnForTransaction(pool, wrongCh)).toBe(0);
    const ok = await makeTxn({ source: "web", total: 300_000 });
    expect(await earnForTransaction(pool, ok)).toBe(300);
  });

  it("điều kiện day_of_week: chỉ tích cuối tuần", async () => {
    // 2026-07-08 là Thứ Tư (UTCDay=3); rule chỉ T7(6)/CN(0) -> không áp.
    await setEarnRule(pool, { ruleKey: "weekend", name: "Weekend", currencyCode: "OCC_POINT", ratePerUnit: 0.001, conditions: { day_of_week: [6, 0] } }, "admin");
    const wed = await makeTxn({ total: 100_000, time: "2026-07-08T10:00:00Z" });
    expect(await earnForTransaction(pool, wed)).toBe(0);
    const sun = await makeTxn({ total: 100_000, time: "2026-07-12T10:00:00Z" }); // Chủ nhật
    expect(await earnForTransaction(pool, sun)).toBe(100);
  });

  it("day_of_week theo GIỜ VN: T7 02:00 VN (= T6 19:00 UTC) vẫn tính cuối tuần", async () => {
    await setEarnRule(pool, { ruleKey: "weekend", name: "Weekend", currencyCode: "OCC_POINT", ratePerUnit: 0.001, conditions: { day_of_week: [6, 0] } }, "admin");
    // 2026-07-11 là Thứ Bảy; 02:00 giờ VN -> UTC là 2026-07-10T19:00Z (Thứ Sáu). Phải khớp T7 theo giờ VN.
    const mid = await makeTxn({ total: 100_000, time: "2026-07-11T02:00:00+07:00" });
    expect(await earnForTransaction(pool, mid)).toBe(100);
  });

  it("poison-resistance: cờ mất + rule đổi points -> KHÔNG tích trùng, KHÔNG kẹt (idempotent theo message)", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    const mid = await makeTxn({ total: 100_000 });
    expect(await earnForTransaction(pool, mid)).toBe(100);
    // mô phỏng: cờ bị mất (crash giữa chừng đời cũ) + admin đổi rule sang gấp đôi
    await pool.query("UPDATE cdp.canonical_transaction SET loyalty_earned=false WHERE message_id=$1", [mid]);
    await setEarnRule(pool, { ruleKey: "base", name: "Base v2", currencyCode: "OCC_POINT", ratePerUnit: 0.002 }, "admin");
    const again = await earnForTransaction(pool, mid);
    expect(again).toBe(0); // key sys:autoearn tồn tại -> không phát trùng, không IDEMPOTENCY_CONFLICT
    expect((await getBalance(pool, occId)).available).toBe(100); // không thành 300
    const flag = await pool.query<{ e: boolean }>("SELECT loyalty_earned AS e FROM cdp.canonical_transaction WHERE message_id=$1", [mid]);
    expect(flag.rows[0]!.e).toBe(true); // cờ được set lại -> không quét lại vô hạn
  });

  it("earn_rule append-only ở DB: cấm sửa nội dung version + cấm DELETE; chỉ đổi is_active được", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    const id = (await pool.query<{ id: string }>("SELECT id FROM cdp.earn_rule WHERE rule_key='base' AND is_active")).rows[0]!.id;
    await expect(pool.query("UPDATE cdp.earn_rule SET rate_per_unit=999 WHERE id=$1", [id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM cdp.earn_rule WHERE id=$1", [id])).rejects.toThrow(/append-only/);
    await pool.query("UPDATE cdp.earn_rule SET is_active=false WHERE id=$1", [id]); // đổi is_active -> OK
  });

  it("processUnearnedTransactions quét cả lô; bỏ giao dịch chưa gắn occ", async () => {
    await setEarnRule(pool, { ruleKey: "base", name: "Base", currencyCode: "OCC_POINT", ratePerUnit: 0.001 }, "admin");
    await makeTxn({ total: 100_000 });
    await makeTxn({ total: 50_000 });
    await makeTxn({ total: 999_000, occ: null }); // chưa gắn occ -> bỏ qua
    const r = await processUnearnedTransactions(pool, 100);
    expect(r.processed).toBe(2);
    expect(r.earned).toBe(150);
    expect((await getBalance(pool, occId)).available).toBe(150);
    // chạy lại: không còn gì để xử lý
    expect((await processUnearnedTransactions(pool, 100)).processed).toBe(0);
  });
});
