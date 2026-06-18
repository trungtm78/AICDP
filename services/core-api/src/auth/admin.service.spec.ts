import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { setupTestDb } from "../test-helpers/db.js";
import { createUser, login } from "./user.service.js";
import { listUsers, setUserStatus } from "./user.service.js";
import { listApiKeys, createApiKey, revokeApiKey } from "./apikey.service.js";

const uniq = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  // dọn user/key test tạo ra (giữ seed test-admin)
  await pool.query("DELETE FROM cdp.app_user WHERE username LIKE 'u\\_%'");
  await pool.query("DELETE FROM cdp.api_key WHERE name LIKE 'k\\_%'");
});

describe("admin — user management", () => {
  it("listUsers không lộ password_hash; setUserStatus disable chặn login", async () => {
    const username = uniq();
    const u = await createUser(pool, { username, password: "secret12345", role: "marketer", name: "M" });
    const list = await listUsers(pool);
    const found = list.find((x) => x.username === username);
    expect(found).toBeTruthy();
    expect(found as object).not.toHaveProperty("password_hash");

    await setUserStatus(pool, u.id, "disabled");
    const after = await login(pool, username, "secret12345");
    expect(after).toBeNull(); // disabled -> không login được
  });
});

describe("admin — api key management", () => {
  it("createApiKey trả raw MỘT lần + lưu hash; listApiKeys không lộ hash; revoke vô hiệu", async () => {
    const created = await createApiKey(pool, { name: `k_${Date.now()}`, role: "connector" });
    expect(created.rawKey).toBeTruthy();
    // hash lưu đúng sha256 của raw
    const hash = createHash("sha256").update(created.rawKey).digest("hex");
    const row = await pool.query<{ status: string }>(
      "SELECT status FROM cdp.api_key WHERE key_hash=$1",
      [hash],
    );
    expect(row.rows[0]!.status).toBe("active");

    const list = await listApiKeys(pool);
    const found = list.find((k) => k.id === created.id);
    expect(found).toBeTruthy();
    expect(found as object).not.toHaveProperty("key_hash");

    await revokeApiKey(pool, created.id);
    const after = await pool.query<{ status: string }>(
      "SELECT status FROM cdp.api_key WHERE id=$1",
      [created.id],
    );
    expect(after.rows[0]!.status).toBe("revoked");
  });
});
