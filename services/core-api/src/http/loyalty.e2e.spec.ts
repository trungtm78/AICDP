import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";

let app: INestApplication;

beforeAll(async () => {
  await setupTestDb();
  app = await createApp();
  await app.init();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await truncateAll();
});

const http = () => request(app.getHttpServer());

/** Tạo một occId qua identify (đường dữ liệu thật, không insert tay). */
async function makeOcc(phone: string): Promise<string> {
  const res = await http()
    .post("/v1/ingest")
    .send({ type: "identify", brand_id: "givral", identifiers: [{ type: "phone", value: phone }] });
  return res.body.data.occId as string;
}

describe("loyalty HTTP", () => {
  it("earn -> balance; replay idempotent không cộng trùng", async () => {
    const occId = await makeOcc("0901000001");

    const e1 = await http()
      .post("/v1/loyalty/earn")
      .send({ occId, points: 100, idempotencyKey: "earn-1" });
    expect(e1.status).toBe(201);
    expect(e1.body.data.balance.available).toBe(100);
    expect(e1.body.data.idempotent).toBe(false);

    const e2 = await http()
      .post("/v1/loyalty/earn")
      .send({ occId, points: 100, idempotencyKey: "earn-1" });
    expect(e2.body.data.idempotent).toBe(true);
    expect(e2.body.data.balance.available).toBe(100);

    const bal = await http().get("/v1/loyalty/balance").query({ occId });
    expect(bal.status).toBe(200);
    expect(bal.body.data.available).toBe(100);
  });

  it("reserve -> capture theo reservationId, đúng số dư", async () => {
    const occId = await makeOcc("0901000002");
    await http().post("/v1/loyalty/earn").send({ occId, points: 100, idempotencyKey: "e2" });

    const r = await http()
      .post("/v1/loyalty/reserve")
      .send({ occId, points: 40, idempotencyKey: "r2" });
    expect(r.body.data.balance.available).toBe(60);
    expect(r.body.data.balance.reserved).toBe(40);
    const reservationId = r.body.data.reservationId as string;
    expect(reservationId).toBeTruthy();

    const c = await http()
      .post("/v1/loyalty/capture")
      .send({ reservationId, idempotencyKey: "c2" });
    expect(c.body.data.balance.reserved).toBe(0);
  });

  it("reserve quá available -> 409 INSUFFICIENT_BALANCE", async () => {
    const occId = await makeOcc("0901000003");
    await http().post("/v1/loyalty/earn").send({ occId, points: 10, idempotencyKey: "e3" });
    const r = await http()
      .post("/v1/loyalty/reserve")
      .send({ occId, points: 50, idempotencyKey: "r3" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("INSUFFICIENT_BALANCE");
  });

  it("points không hợp lệ -> 400 INVALID_AMOUNT", async () => {
    const occId = await makeOcc("0901000004");
    const r = await http()
      .post("/v1/loyalty/earn")
      .send({ occId, points: -5, idempotencyKey: "e4" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_AMOUNT");
  });
});
