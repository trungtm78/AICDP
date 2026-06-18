import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import {
  ingestOrderCompleted,
  ingestIdentify,
  getCustomer360,
} from "./ingestion.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

function order(overrides: Record<string, unknown> = {}) {
  return {
    brand_id: "givral",
    store_id: "givral-q1",
    source: "pos",
    occ_timestamp: "2026-06-18T10:00:00+07:00",
    identifiers: [{ type: "phone", value: "0901234567" }],
    properties: {
      pos_transaction_id: "T1",
      currency: "VND",
      total: 250000,
      payment_method: "cash",
      business_date: "2026-06-18",
      items: [{ sku: "GV-01", name: "Bánh kem", quantity: 1, unit_price: 250000 }],
    },
    ...overrides,
  };
}

describe("ingestOrderCompleted", () => {
  it("ghi canonical transaction và resolve OCC ID", async () => {
    const r = await ingestOrderCompleted(pool, order() as never);
    expect(r.idempotent).toBe(false);
    expect(r.occId).not.toBeNull();
    expect(r.messageId).toBe("givral:givral-q1:T1");

    const txn = await pool.query(
      "SELECT occ_id, total FROM cdp.canonical_transaction WHERE message_id=$1",
      [r.messageId],
    );
    expect(txn.rows.length).toBe(1);
    expect(Number(txn.rows[0]!.total)).toBe(250000);
    expect(txn.rows[0]!.occ_id).toBe(r.occId);
  });

  it("idempotent: replay cùng giao dịch không tạo trùng", async () => {
    const a = await ingestOrderCompleted(pool, order() as never);
    const b = await ingestOrderCompleted(pool, order() as never);
    expect(b.idempotent).toBe(true);
    expect(b.occId).toBe(a.occId);
    const cnt = await pool.query(
      "SELECT count(*)::int AS n FROM cdp.canonical_transaction",
    );
    expect(cnt.rows[0]!.n).toBe(1);
  });

  it("idempotency-race: khi INSERT đụng conflict (concurrent) phải trả idempotent=true, KHÔNG báo created", async () => {
    // Điều khiển interleaving xác định: một transaction khác chèn cùng message_id
    // nhưng CHƯA commit -> ingest sẽ block ở INSERT ON CONFLICT, sau khi tx kia
    // commit thì ingest gặp conflict (rowCount=0) và phải nhận diện idempotent.
    const messageId = "givral:givral-q1:RACE-DET";
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(
        `INSERT INTO cdp.canonical_transaction
           (message_id, brand_id, store_id, source, pos_transaction_id, total, occ_timestamp, items)
         VALUES ($1,'givral','givral-q1','pos','RACE-DET',1,now(),'[]')`,
        [messageId],
      );

      const pending = ingestOrderCompleted(
        pool,
        order({
          identifiers: [],
          properties: { pos_transaction_id: "RACE-DET", total: 999, items: [] },
        }) as never,
      );
      // Cho ingest chạy tới INSERT và bị block bởi lock của blocker.
      await new Promise((r) => setTimeout(r, 300));
      await blocker.query("COMMIT"); // nhả lock -> ingest gặp conflict

      const r = await pending;
      expect(r.idempotent).toBe(true); // PHẢI nhận diện duplicate, không phải created
    } finally {
      blocker.release();
    }

    const cnt = await pool.query(
      "SELECT count(*)::int AS n FROM cdp.canonical_transaction WHERE message_id=$1",
      [messageId],
    );
    expect(cnt.rows[0]!.n).toBe(1);
  });

  it("giao dịch ẩn danh (không identifier) vẫn được ghi với occ_id null", async () => {
    const r = await ingestOrderCompleted(
      pool,
      order({ identifiers: [], properties: { pos_transaction_id: "T2", total: 100000, items: [] } }) as never,
    );
    expect(r.occId).toBeNull();
    const txn = await pool.query(
      "SELECT occ_id FROM cdp.canonical_transaction WHERE message_id=$1",
      [r.messageId],
    );
    expect(txn.rows[0]!.occ_id).toBeNull();
  });
});

describe("ingestIdentify + survivorship", () => {
  it("cập nhật profile traits theo survivorship (không ghi đè field đã có)", async () => {
    const r1 = await ingestIdentify(pool, {
      brand_id: "givral",
      identifiers: [{ type: "phone", value: "0901234567" }],
      traits: { full_name: "Nguyễn Văn A", city: "HCM" },
    } as never);
    // lần 2: cùng người, full_name khác -> KHÔNG ghi đè; bổ sung email
    await ingestIdentify(pool, {
      brand_id: "givral",
      identifiers: [
        { type: "phone", value: "0901234567" },
        { type: "email", value: "a@example.com" },
      ],
      traits: { full_name: "Tên Khác", email: "a@example.com" },
    } as never);

    const p = await pool.query(
      "SELECT full_name, email, city FROM cdp.profile WHERE occ_id=$1",
      [r1.occId],
    );
    expect(p.rows[0]!.full_name).toBe("Nguyễn Văn A"); // giữ giá trị đầu
    expect(p.rows[0]!.email).toBe("a@example.com"); // bổ sung field trống
    expect(p.rows[0]!.city).toBe("HCM");
  });
});

describe("getCustomer360", () => {
  it("tra cứu theo phone trả profile + giao dịch", async () => {
    await ingestIdentify(pool, {
      brand_id: "givral",
      identifiers: [{ type: "phone", value: "0901234567" }],
      traits: { full_name: "Nguyễn Văn A" },
    } as never);
    await ingestOrderCompleted(pool, order() as never);

    const c = await getCustomer360(pool, { type: "phone", value: "0901234567" });
    expect(c).not.toBeNull();
    expect(c!.profile.full_name).toBe("Nguyễn Văn A");
    expect(c!.identifiers.map((i) => i.identifier_type)).toContain("phone");
    expect(c!.transactions.length).toBe(1);
    expect(Number(c!.transactions[0]!.total)).toBe(250000);
  });

  it("trả null khi không tìm thấy", async () => {
    const c = await getCustomer360(pool, { type: "phone", value: "0909999999" });
    expect(c).toBeNull();
  });
});
