import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { createUser, login } from "./user.service.js";
import { requestReset, confirmReset } from "./password-reset.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  await pool.query("TRUNCATE cdp.app_user, cdp.api_key RESTART IDENTITY CASCADE");
});

async function mkUser(username = "u1", password = "matkhaucu123") {
  return createUser(pool, { username, password, role: "csr", name: "Người dùng" });
}

describe("password-reset — requestReset", () => {
  it("user tồn tại: trả token, DB lưu BĂM sha256 (không lưu token thô), hết hạn tương lai", async () => {
    await mkUser();
    const res = await requestReset(pool, "u1");
    expect(res.ok).toBe(true);
    expect(res.token).toBeTruthy();

    const r = await pool.query<{ token_hash: string; expires_at: string; used_at: string | null }>(
      "SELECT token_hash, expires_at, used_at FROM cdp.password_reset",
    );
    expect(r.rowCount).toBe(1);
    const expected = createHash("sha256").update(res.token!).digest("hex");
    expect(r.rows[0]!.token_hash).toBe(expected); // lưu băm, KHÔNG lưu token thô
    expect(new Date(r.rows[0]!.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(r.rows[0]!.used_at).toBeNull();
  });

  it("user KHÔNG tồn tại: vẫn ok:true nhưng không token, không ghi DB (chống dò tài khoản)", async () => {
    const res = await requestReset(pool, "khong_ton_tai");
    expect(res.ok).toBe(true);
    expect(res.token).toBeUndefined();
    const r = await pool.query("SELECT count(*)::int AS c FROM cdp.password_reset");
    expect((r.rows[0] as { c: number }).c).toBe(0);
  });

  it("user bị vô hiệu (disabled): không cấp token", async () => {
    const u = await mkUser("u_disabled");
    await pool.query("UPDATE cdp.app_user SET status='disabled' WHERE id=$1", [u.id]);
    const res = await requestReset(pool, "u_disabled");
    expect(res.ok).toBe(true);
    expect(res.token).toBeUndefined();
  });
});

describe("password-reset — confirmReset", () => {
  it("token đúng: đổi mật khẩu, đăng nhập bằng mật khẩu MỚI, token đánh dấu đã dùng", async () => {
    await mkUser("u2", "matkhaucu123");
    const { token } = await requestReset(pool, "u2");
    await confirmReset(pool, token!, "matkhaumoi456");

    expect(await login(pool, "u2", "matkhaucu123")).toBeNull();
    expect(await login(pool, "u2", "matkhaumoi456")).not.toBeNull();

    const r = await pool.query<{ used_at: string | null }>("SELECT used_at FROM cdp.password_reset");
    expect(r.rows[0]!.used_at).not.toBeNull();
  });

  it("token sai → RESET_TOKEN_INVALID", async () => {
    await expect(confirmReset(pool, "token-bay-ba", "matkhaumoi456")).rejects.toMatchObject({
      code: "RESET_TOKEN_INVALID",
    });
  });

  it("token hết hạn → RESET_TOKEN_INVALID, mật khẩu KHÔNG đổi", async () => {
    await mkUser("u3", "matkhaucu123");
    const { token } = await requestReset(pool, "u3");
    await pool.query("UPDATE cdp.password_reset SET expires_at = now() - interval '1 minute'");
    await expect(confirmReset(pool, token!, "matkhaumoi456")).rejects.toMatchObject({
      code: "RESET_TOKEN_INVALID",
    });
    expect(await login(pool, "u3", "matkhaucu123")).not.toBeNull();
  });

  it("token dùng lần 2 → RESET_TOKEN_INVALID (one-time)", async () => {
    await mkUser("u4", "matkhaucu123");
    const { token } = await requestReset(pool, "u4");
    await confirmReset(pool, token!, "matkhaumoi456");
    await expect(confirmReset(pool, token!, "matkhaukhac789")).rejects.toMatchObject({
      code: "RESET_TOKEN_INVALID",
    });
    expect(await login(pool, "u4", "matkhaumoi456")).not.toBeNull();
  });
});
