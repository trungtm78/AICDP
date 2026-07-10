import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { recordConsent, verifyConsentChain } from "./consent.service.js";

async function newOcc(): Promise<string> {
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  return r.rows[0]!.occ_id;
}

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

describe("consent hash-chain (tamper-evident)", () => {
  it("chuỗi hợp lệ sau nhiều lần ghi; mỗi row có row_hash + prev_hash liên kết", async () => {
    const a = await newOcc();
    const b = await newOcc();
    await recordConsent(pool, { occId: a, purpose: "marketing_email", status: "granted", source: "web" });
    await recordConsent(pool, { occId: a, purpose: "marketing_email", status: "withdrawn", source: "csr" });
    await recordConsent(pool, { occId: b, purpose: "marketing_sms", status: "granted", source: "pos" });

    const v = await verifyConsentChain(pool);
    expect(v.valid).toBe(true);
    expect(v.total).toBe(3);
    expect(v.brokenAtId).toBeNull();

    // liên kết: prev_hash của dòng sau = row_hash của dòng trước
    const rows = await pool.query<{ prev_hash: string | null; row_hash: string }>(
      "SELECT prev_hash, row_hash FROM cdp.consent_record ORDER BY id",
    );
    expect(rows.rows[0]!.prev_hash).toBeNull();
    expect(rows.rows[1]!.prev_hash).toBe(rows.rows[0]!.row_hash);
    expect(rows.rows[2]!.prev_hash).toBe(rows.rows[1]!.row_hash);
  });

  it("chuỗi hợp lệ với >=11 bản ghi (chống hồi quy: ORDER BY id phải NUMERIC, không TEXT)", async () => {
    // Lỗi cũ: SELECT id::text AS id ... ORDER BY id -> sort '1','10','11','2' (text) làm duyệt
    // chuỗi SAI thứ tự khi >=10 dòng. Test này tạo 12 dòng để id vượt 1 chữ số.
    const a = await newOcc();
    const purposes = ["marketing_email", "marketing_sms", "marketing_zalo"];
    for (let i = 0; i < 12; i++) {
      await recordConsent(pool, {
        occId: a,
        purpose: purposes[i % purposes.length]!,
        status: i % 2 === 0 ? "granted" : "withdrawn",
        source: "web",
      });
    }
    const v = await verifyConsentChain(pool);
    expect(v.valid).toBe(true);
    expect(v.total).toBe(12);
    expect(v.brokenAtId).toBeNull();
  });

  it("PHÁT HIỆN sửa lịch sử: tắt trigger + UPDATE 1 dòng -> verify báo gãy chuỗi", async () => {
    const a = await newOcc();
    await recordConsent(pool, { occId: a, purpose: "marketing_email", status: "granted", source: "web" });
    await recordConsent(pool, { occId: a, purpose: "marketing_email", status: "withdrawn", source: "csr" });

    // Mô phỏng kẻ tấn công có quyền DB tắt trigger rồi sửa "withdrawn" -> "granted".
    const tampered = await pool.query<{ id: string }>(
      "SELECT id::text FROM cdp.consent_record WHERE status='withdrawn' LIMIT 1",
    );
    const id = tampered.rows[0]!.id;
    await pool.query("ALTER TABLE cdp.consent_record DISABLE TRIGGER trg_consent_immutable");
    await pool.query("UPDATE cdp.consent_record SET status='granted' WHERE id=$1", [id]);
    await pool.query("ALTER TABLE cdp.consent_record ENABLE TRIGGER trg_consent_immutable");

    const v = await verifyConsentChain(pool);
    expect(v.valid).toBe(false); // chuỗi băm phát hiện sửa
    expect(v.brokenAtId).toBe(id);
  });
});
