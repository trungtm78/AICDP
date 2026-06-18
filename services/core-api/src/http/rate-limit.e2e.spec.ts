import "reflect-metadata";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb } from "../test-helpers/db.js";
import { ADMIN_KEY } from "../test-helpers/auth.js";

// Rate-limit bật bằng env (burst nhỏ) TRƯỚC khi tạo app -> guard đọc lúc khởi tạo.
let app: INestApplication;

beforeAll(async () => {
  await setupTestDb();
  process.env.RATE_LIMIT_SOURCE_BURST = "3";
  process.env.RATE_LIMIT_SOURCE_REFILL_PER_SEC = "1"; // hồi chậm để cạn token trong test
  process.env.RATE_LIMIT_PUBLIC_BURST = "2"; // login (public) chặt hơn
  process.env.RATE_LIMIT_PUBLIC_REFILL_PER_SEC = "1";
  app = await createApp();
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.RATE_LIMIT_SOURCE_BURST;
  delete process.env.RATE_LIMIT_SOURCE_REFILL_PER_SEC;
  delete process.env.RATE_LIMIT_PUBLIC_BURST;
  delete process.env.RATE_LIMIT_PUBLIC_REFILL_PER_SEC;
});

describe("rate-limit theo source (RATE_LIMIT_SOURCE_BURST)", () => {
  it("vượt burst -> 429 RATE_LIMIT_SOURCE_BURST + error envelope + header Retry-After", async () => {
    const srv = request(app.getHttpServer());
    const call = () => srv.get("/v1/brands").set("Authorization", `Bearer ${ADMIN_KEY}`);

    // burst=3 -> 3 request đầu OK (cùng source = admin key).
    expect((await srv.get("/v1/brands").set("Authorization", `Bearer ${ADMIN_KEY}`)).status).toBe(200);
    expect((await srv.get("/v1/brands").set("Authorization", `Bearer ${ADMIN_KEY}`)).status).toBe(200);
    expect((await srv.get("/v1/brands").set("Authorization", `Bearer ${ADMIN_KEY}`)).status).toBe(200);

    // Request thứ 4 vượt burst -> 429.
    const blocked = await call();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT_SOURCE_BURST");
    expect(blocked.body.error.retryable).toBe(true);
    expect(blocked.body.error).toHaveProperty("correlation_id");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("@SkipRateLimit (health) KHÔNG bị rate-limit dù burst đã cạn", async () => {
    const srv = request(app.getHttpServer());
    // health @SkipRateLimit -> probe gọi dày vẫn 200.
    for (let i = 0; i < 6; i++) {
      const r = await srv.get("/v1/health");
      expect(r.status).toBe(200);
    }
  });

  it("login (@Public) bị giới hạn theo IP -> chống brute force credential stuffing", async () => {
    const srv = request(app.getHttpServer());
    const tryLogin = () =>
      srv.post("/v1/auth/login").send({ username: "khong-ton-tai", password: "sai-mat-khau" });

    // public burst=2: 2 lần đầu trả 401 (sai cred, KHÔNG phải vì thiếu auth/rate-limit).
    expect((await tryLogin()).status).toBe(401);
    expect((await tryLogin()).status).toBe(401);
    // Lần 3 vượt giới hạn public theo IP -> 429 (brute force bị chặn).
    const blocked = await tryLogin();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT_SOURCE_BURST");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });
});
