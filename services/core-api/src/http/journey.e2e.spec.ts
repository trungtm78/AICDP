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

async function buy(phone: string, total: number, txn: string) {
  await http()
    .post("/v1/ingest")
    .send({
      type: "order_completed",
      brand_id: "givral",
      store_id: "s1",
      source: "pos",
      occ_timestamp: "2026-06-18T03:00:00.000Z",
      identifiers: [{ type: "phone", value: phone }],
      properties: { pos_transaction_id: txn, total },
    });
}

describe("journey HTTP", () => {
  it("tạo + chạy journey loyalty_bonus", async () => {
    await buy("0906000001", 300000, "j-1");
    const create = await http()
      .post("/v1/journeys")
      .send({
        name: "VIP bonus",
        segmentCriteria: { minSpend: 250000 },
        action: { type: "loyalty_bonus", points: 100 },
      });
    expect(create.status).toBe(201);
    const journeyId = create.body.data.journey_id;

    const run = await http().post(`/v1/journeys/${journeyId}/run`);
    expect(run.status).toBe(200);
    expect(run.body.data.total).toBe(1);
    expect(run.body.data.actionResult.credited).toBe(1);

    const list = await http().get("/v1/journeys");
    expect(list.body.data.some((j: { name: string }) => j.name === "VIP bonus")).toBe(true);
  });

  it("action sai schema -> 400", async () => {
    const res = await http()
      .post("/v1/journeys")
      .send({ name: "x", action: { type: "khong_co" } });
    expect(res.status).toBe(400);
  });
});
