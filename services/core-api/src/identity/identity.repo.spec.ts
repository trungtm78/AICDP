import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { resolveOccId } from "./identity.repo.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

async function countIdentities(): Promise<number> {
  const r = await pool.query("SELECT count(*)::int AS n FROM cdp.occ_identity");
  return r.rows[0].n;
}

describe("resolveOccId — deterministic", () => {
  it("tạo OCC ID mới cho phone chưa tồn tại", async () => {
    const occId = await resolveOccId(pool, [
      { type: "phone", value: "0901234567" },
    ]);
    expect(occId).toMatch(UUID_RE);
    expect(await countIdentities()).toBe(1);
  });

  it("trả cùng OCC ID khi resolve lại cùng phone", async () => {
    const a = await resolveOccId(pool, [{ type: "phone", value: "0901234567" }]);
    const b = await resolveOccId(pool, [{ type: "phone", value: "090 123 4567" }]);
    expect(b).toBe(a);
    expect(await countIdentities()).toBe(1);
  });

  it("stitch: phone+email lần đầu, sau đó chỉ email -> cùng OCC ID", async () => {
    const a = await resolveOccId(pool, [
      { type: "phone", value: "0901234567" },
      { type: "email", value: "a@example.com" },
    ]);
    const b = await resolveOccId(pool, [
      { type: "email", value: "A@Example.com" },
    ]);
    expect(b).toBe(a);
    expect(await countIdentities()).toBe(1);
  });

  it("merge: hai OCC ID riêng (phone-only, email-only) gặp event có cả hai -> hợp nhất", async () => {
    const p = await resolveOccId(pool, [{ type: "phone", value: "0901234567" }]);
    const e = await resolveOccId(pool, [{ type: "email", value: "a@example.com" }]);
    expect(p).not.toBe(e);
    expect(await countIdentities()).toBe(2);

    const merged = await resolveOccId(pool, [
      { type: "phone", value: "0901234567" },
      { type: "email", value: "a@example.com" },
    ]);
    // survivor là một trong hai
    expect([p, e]).toContain(merged);
    // cả hai identifier giờ trỏ về cùng survivor
    const r = await pool.query(
      "SELECT DISTINCT occ_id FROM cdp.identity_edge WHERE occ_id = $1",
      [merged],
    );
    expect(r.rows.length).toBe(1);
    const log = await pool.query("SELECT count(*)::int AS n FROM cdp.identity_merge_log");
    expect(log.rows[0].n).toBe(1);
  });

  it("bỏ qua identifier không hợp lệ (phone sai) nhưng vẫn dùng email hợp lệ", async () => {
    const occId = await resolveOccId(pool, [
      { type: "phone", value: "0123456789" }, // sai đầu số -> bỏ qua
      { type: "email", value: "valid@example.com" },
    ]);
    expect(occId).toMatch(UUID_RE);
    const r = await pool.query(
      "SELECT identifier_type FROM cdp.identity_edge WHERE occ_id=$1",
      [occId],
    );
    const types = r.rows.map((x) => x.identifier_type);
    expect(types).toContain("email");
    expect(types).not.toContain("phone");
  });

  it("trả null khi không có identifier hợp lệ nào", async () => {
    const occId = await resolveOccId(pool, [
      { type: "phone", value: "abc" },
    ]);
    expect(occId).toBeNull();
    expect(await countIdentities()).toBe(0);
  });

  it("concurrent: 8 resolve cùng phone đồng thời -> đúng 1 OCC ID", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        resolveOccId(pool, [{ type: "phone", value: "0987654321" }]),
      ),
    );
    const distinct = new Set(results);
    expect(distinct.size).toBe(1);
    expect(await countIdentities()).toBe(1);
  });
});
