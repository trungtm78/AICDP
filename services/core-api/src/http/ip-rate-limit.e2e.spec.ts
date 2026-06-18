import "reflect-metadata";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb } from "../test-helpers/db.js";

// Pre-auth IP limiter bật bằng env TRƯỚC khi tạo app. File riêng vì key theo IP (supertest
// dùng chung 1 IP) -> sẽ nhiễu các test khác nếu chung app.
let app: INestApplication;

beforeAll(async () => {
  await setupTestDb();
  process.env.RATE_LIMIT_IP_BURST = "2";
  process.env.RATE_LIMIT_IP_REFILL_PER_SEC = "1";
  app = await createApp();
  await app.init();
});

afterAll(async () => {
  await app.close();
  delete process.env.RATE_LIMIT_IP_BURST;
  delete process.env.RATE_LIMIT_IP_REFILL_PER_SEC;
});

describe("pre-auth IP rate-limit (RATE_LIMIT_IP_BURST)", () => {
  it("token SAI vẫn bị chặn theo IP TRƯỚC auth -> 429 (không tốn JWT/DB cho flood)", async () => {
    const srv = request(app.getHttpServer());
    const badToken = () => srv.get("/v1/brands").set("Authorization", "Bearer token-bay-bien-sai");

    // burst=2: 2 request đầu tới được AuthGuard -> 401 (token sai).
    expect((await badToken()).status).toBe(401);
    expect((await badToken()).status).toBe(401);
    // Request thứ 3 bị IP guard chặn TRƯỚC auth -> 429 (không phải 401).
    const blocked = await badToken();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("RATE_LIMIT_SOURCE_BURST");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("@SkipRateLimit (health) KHÔNG bị IP limiter chặn", async () => {
    const srv = request(app.getHttpServer());
    for (let i = 0; i < 5; i++) {
      expect((await srv.get("/v1/health")).status).toBe(200);
    }
  });
});
