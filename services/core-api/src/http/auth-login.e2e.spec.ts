import "reflect-metadata";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb } from "../test-helpers/db.js";
import { ADMIN_KEY } from "../test-helpers/auth.js";
import { pool } from "../db/pool.js";

let app: INestApplication;
const U = `mkt_${Date.now()}`;

beforeAll(async () => {
  await setupTestDb();
  app = await createApp();
  await app.init();
  await pool.query("DELETE FROM cdp.app_user WHERE username=$1", [U]);
});
afterAll(async () => {
  await pool.query("DELETE FROM cdp.app_user WHERE username=$1", [U]);
  await app.close();
});

const srv = () => request(app.getHttpServer());

describe("login/JWT flow", () => {
  it("admin tạo user -> login -> JWT truy cập theo role; sai role -> 403", async () => {
    // admin (API key) tạo user marketer
    const created = await srv()
      .post("/v1/auth/users")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({ username: U, password: "secret12345", role: "marketer", name: "Marketer Test" });
    expect(created.status).toBe(201);

    // login
    const login = await srv().post("/v1/auth/login").send({ username: U, password: "secret12345" });
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    expect(token).toBeTruthy();
    expect(login.body.data.role).toBe("marketer");

    // dùng JWT: analytics (marketer được) -> 200
    const ok = await srv()
      .get("/v1/analytics/overview")
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);

    // dùng JWT: tạo store (cần data_steward) -> 403
    const forbidden = await srv()
      .post("/v1/stores")
      .set("Authorization", `Bearer ${token}`)
      .send({ store_id: "s1", brand_id: "givral", name: "X" });
    expect(forbidden.status).toBe(403);
  });

  it("user bị disable -> JWT cũ bị từ chối ngay (role lấy từ DB, không tin token)", async () => {
    const login = await srv().post("/v1/auth/login").send({ username: U, password: "secret12345" });
    const token = login.body.data.token as string;
    // vô hiệu user
    await pool.query("UPDATE cdp.app_user SET status='disabled' WHERE username=$1", [U]);
    const res = await srv()
      .get("/v1/analytics/overview")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    // khôi phục để các test sau dùng
    await pool.query("UPDATE cdp.app_user SET status='active' WHERE username=$1", [U]);
  });

  it("sai mật khẩu -> 401", async () => {
    const r = await srv().post("/v1/auth/login").send({ username: U, password: "wrong" });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("login là public (không cần token)", async () => {
    const r = await srv().post("/v1/auth/login").send({ username: "nope", password: "x" });
    expect(r.status).toBe(401); // 401 vì sai cred, KHÔNG phải vì thiếu auth
  });
});
