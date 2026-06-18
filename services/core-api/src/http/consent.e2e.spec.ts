import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ADMIN_KEY } from "../test-helpers/auth.js";

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

const srv = () => request(app.getHttpServer());
const bearer = (t: ReturnType<typeof srv>) => t.set("Authorization", `Bearer ${ADMIN_KEY}`);
const http = () => ({
  get: (p: string) => bearer(srv().get(p)),
  post: (p: string) => bearer(srv().post(p)),
});

async function makeOcc(phone: string): Promise<string> {
  const res = await http()
    .post("/v1/ingest")
    .send({ type: "identify", brand_id: "givral", identifiers: [{ type: "phone", value: phone }] });
  return res.body.data.occId as string;
}

describe("consent HTTP", () => {
  it("deny-by-default: check khi chưa có bản ghi -> allowed=false", async () => {
    const occId = await makeOcc("0902000001");
    const r = await http()
      .get("/v1/consent/check")
      .query({ occId, purpose: "marketing_email" });
    expect(r.status).toBe(200);
    expect(r.body.data.allowed).toBe(false);
  });

  it("grant -> check allowed=true; withdraw -> allowed=false", async () => {
    const occId = await makeOcc("0902000002");
    await http()
      .post("/v1/consent")
      .send({ occId, purpose: "marketing_email", status: "granted", source: "web" });
    let r = await http().get("/v1/consent/check").query({ occId, purpose: "marketing_email" });
    expect(r.body.data.allowed).toBe(true);

    await http()
      .post("/v1/consent")
      .send({ occId, purpose: "marketing_email", status: "withdrawn", source: "csr" });
    r = await http().get("/v1/consent/check").query({ occId, purpose: "marketing_email" });
    expect(r.body.data.allowed).toBe(false);
  });

  it("GET /v1/consent liệt kê trạng thái hiện tại theo purpose", async () => {
    const occId = await makeOcc("0902000003");
    await http()
      .post("/v1/consent")
      .send({ occId, purpose: "marketing_sms", status: "granted", source: "web" });
    const r = await http().get("/v1/consent").query({ occId });
    expect(r.status).toBe(200);
    const byPurpose = Object.fromEntries(
      r.body.data.map((c: { purpose: string; status: string }) => [c.purpose, c.status]),
    );
    expect(byPurpose["marketing_sms"]).toBe("granted");
  });

  it("purpose không hợp lệ -> 400 SCHEMA_TYPE_MISMATCH", async () => {
    const occId = await makeOcc("0902000004");
    const r = await http()
      .post("/v1/consent")
      .send({ occId, purpose: "khong_hop_le", status: "granted", source: "web" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("SCHEMA_TYPE_MISMATCH");
  });
});
