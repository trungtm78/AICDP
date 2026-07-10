import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ensureKey, withAuth, ADMIN_KEY } from "../test-helpers/auth.js";

let app: INestApplication;

beforeAll(async () => {
  await setupTestDb();
  app = await createApp();
  await app.init();
  await ensureKey("test-analyst", "analyst", "key-analyst");
  await ensureKey("test-marketer", "marketer", "key-marketer");
  await ensureKey("test-steward", "data_steward", "key-steward");
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await truncateAll();
});

const http = () => request(app.getHttpServer());

describe("auth/RBAC", () => {
  it("health là public -> 200 không cần token", async () => {
    const r = await http().get("/v1/health");
    expect(r.status).toBe(200);
  });

  it("route bảo vệ KHÔNG token -> 401 UNAUTHENTICATED (deny-by-default)", async () => {
    const r = await http().get("/v1/analytics/overview");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("token sai -> 401", async () => {
    const r = await withAuth(http().get("/v1/analytics/overview"), "khong-ton-tai");
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("analyst xem analytics -> 200", async () => {
    const r = await withAuth(http().get("/v1/analytics/overview"), "key-analyst");
    expect(r.status).toBe(200);
  });

  it("marketer KHÔNG được tạo store -> 403 FORBIDDEN", async () => {
    const r = await withAuth(
      http().post("/v1/stores").send({ store_id: "s1", brand_id: "givral", name: "X" }),
      "key-marketer",
    );
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe("FORBIDDEN");
  });

  it("data_steward tạo store -> 201", async () => {
    const r = await withAuth(
      http().post("/v1/stores").send({ store_id: "s1", brand_id: "givral", name: "X" }),
      "key-steward",
    );
    expect(r.status).toBe(201);
  });

  it("admin vượt mọi role -> tạo store 201", async () => {
    const r = await withAuth(
      http().post("/v1/stores").send({ store_id: "s2", brand_id: "givral", name: "Y" }),
      ADMIN_KEY,
    );
    expect(r.status).toBe(201);
  });

  // ── R0 hardening: password-reset không lộ token qua kênh public ──
  it("password-reset/request công khai -> 200 ok:true, KHÔNG trả resetToken (chống chiếm tài khoản)", async () => {
    await withAuth(http().post("/v1/auth/users").send({ username: "u_reset", password: "Init@123", role: "analyst", name: "U" }), ADMIN_KEY);
    const r = await http().post("/v1/auth/password-reset/request").send({ username: "u_reset" });
    expect(r.status).toBe(200);
    expect(r.body.data.ok).toBe(true);
    expect(r.body.data.resetToken).toBeUndefined(); // KHÔNG lộ token
  });

  it("admin /reset-link -> trả token cho user tồn tại (đường an toàn thay email)", async () => {
    await withAuth(http().post("/v1/auth/users").send({ username: "u_reset2", password: "Init@123", role: "analyst", name: "U2" }), ADMIN_KEY);
    const r = await withAuth(http().post("/v1/auth/reset-link").send({ username: "u_reset2" }), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(typeof r.body.data.resetToken).toBe("string");
    expect(r.body.data.resetToken.length).toBeGreaterThan(20);
  });

  it("reset-link KHÔNG cho marketer -> 403 (chỉ admin/data_steward)", async () => {
    const r = await withAuth(http().post("/v1/auth/reset-link").send({ username: "admin" }), "key-marketer");
    expect(r.status).toBe(403);
  });
});
