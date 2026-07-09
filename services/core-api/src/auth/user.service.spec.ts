import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { createUser, updateUser, deleteUser, login } from "./user.service.js";
import { createApiKey, deleteApiKey, listApiKeys } from "./apikey.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  // truncateAll không xoá app_user/api_key (không nằm trong danh sách) -> tự dọn ở đây.
  await truncateAll();
  await pool.query("TRUNCATE cdp.app_user, cdp.api_key RESTART IDENTITY CASCADE");
});

describe("user.service — updateUser/deleteUser", () => {
  it("cập nhật name + role", async () => {
    const u = await createUser(pool, {
      username: "u1",
      password: "matkhau123",
      role: "csr",
      name: "Cũ",
    });
    const ok = await updateUser(pool, u.id, { name: "Mới", role: "analyst" });
    expect(ok).toBe(true);
    const r = await pool.query<{ name: string; role: string }>(
      "SELECT name, role FROM cdp.app_user WHERE id=$1",
      [u.id],
    );
    expect(r.rows[0]!.name).toBe("Mới");
    expect(r.rows[0]!.role).toBe("analyst");
  });

  it("đổi password -> đăng nhập bằng mật khẩu mới", async () => {
    const u = await createUser(pool, {
      username: "u2",
      password: "matkhaucu123",
      role: "csr",
      name: "U2",
    });
    expect(await login(pool, "u2", "matkhaucu123")).not.toBeNull();

    const ok = await updateUser(pool, u.id, { password: "matkhaumoi456" });
    expect(ok).toBe(true);
    expect(await login(pool, "u2", "matkhaucu123")).toBeNull();
    expect(await login(pool, "u2", "matkhaumoi456")).not.toBeNull();
  });

  it("cập nhật user không tồn tại trả false", async () => {
    const ok = await updateUser(pool, "00000000-0000-0000-0000-000000000000", { name: "X" });
    expect(ok).toBe(false);
  });

  it("xoá user trả true; xoá lần nữa trả false", async () => {
    const u = await createUser(pool, {
      username: "u3",
      password: "matkhau123",
      role: "csr",
      name: "U3",
    });
    expect(await deleteUser(pool, u.id)).toBe(true);
    expect(await deleteUser(pool, u.id)).toBe(false);
  });
});

describe("apikey.service — deleteApiKey", () => {
  it("tạo rồi xoá api key; xoá lần nữa trả false", async () => {
    const k = await createApiKey(pool, { name: "K1", role: "connector" });
    expect((await listApiKeys(pool)).some((x) => x.id === k.id)).toBe(true);
    expect(await deleteApiKey(pool, k.id)).toBe(true);
    expect(await deleteApiKey(pool, k.id)).toBe(false);
    expect((await listApiKeys(pool)).some((x) => x.id === k.id)).toBe(false);
  });
});
