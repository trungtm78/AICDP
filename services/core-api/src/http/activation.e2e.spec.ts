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

async function makeOcc(phone: string): Promise<string> {
  const res = await http()
    .post("/v1/ingest")
    .send({ type: "identify", brand_id: "givral", identifiers: [{ type: "phone", value: phone }] });
  return res.body.data.occId as string;
}

describe("activation HTTP — consent gate", () => {
  it("chỉ gửi người đã consent; người chưa thì suppress", async () => {
    const a = await makeOcc("0903000001");
    const b = await makeOcc("0903000002");
    await http()
      .post("/v1/consent")
      .send({ occId: a, purpose: "marketing_email", status: "granted", source: "web" });

    const res = await http()
      .post("/v1/activation")
      .send({
        audienceName: "Test audience",
        purpose: "marketing_email",
        channel: "email",
        destination: "rudderstack",
        occIds: [a, b],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.total).toBe(2);
    expect(res.body.data.allowedCount).toBe(1);
    expect(res.body.data.suppressedCount).toBe(1);
    expect(res.body.data.allowed).toEqual([a]);
  });

  it("purpose không hợp lệ -> 400 SCHEMA_TYPE_MISMATCH", async () => {
    const res = await http()
      .post("/v1/activation")
      .send({
        audienceName: "x",
        purpose: "khong_hop_le",
        channel: "email",
        destination: "rudderstack",
        occIds: [],
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEMA_TYPE_MISMATCH");
  });
});
