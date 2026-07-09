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
  put: (p: string) => bearer(srv().put(p)),
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

const segLoyaltyDef = {
  nodes: [
    { id: "e", type: "entry", config: { trigger: "segment", segment: { minSpend: 250000 } } },
    { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 100 } },
    { id: "x", type: "exit" },
  ],
  edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
};

describe("journey HTTP (engine)", () => {
  it("create draft → publish → activate → enroll segment → tick → completed", async () => {
    await buy("0906000001", 300000, "j-1");

    const create = await http().post("/v1/journeys").send({ name: "VIP bonus", triggerType: "segment", definition: segLoyaltyDef });
    expect(create.status).toBe(201);
    expect(create.body.data.status).toBe("draft");
    const jid = create.body.data.journey_id;

    expect((await http().post(`/v1/journeys/${jid}/publish`)).status).toBe(200);
    expect((await http().post(`/v1/journeys/${jid}/activate`)).body.data.status).toBe("active");

    const enr = await http().post(`/v1/journeys/${jid}/enroll`).send({ useSegment: true });
    expect(enr.body.data.enrolled).toBe(1);

    const tick = await http().post("/v1/journeys/tick").send({ limit: 100 });
    expect(tick.body.data.processed).toBeGreaterThanOrEqual(2);

    const parts = await http().get(`/v1/journeys/${jid}/participants`);
    expect(parts.body.data).toHaveLength(1);
    expect(parts.body.data[0].status).toBe("completed");
    expect(parts.body.meta.total).toBe(1);

    const list = await http().get("/v1/journeys");
    expect(list.body.data.some((j: { name: string }) => j.name === "VIP bonus")).toBe(true);

    const rep = await http().get(`/v1/journeys/${jid}/report?windowDays=7`);
    expect(rep.status).toBe(200);
    expect(rep.body.data.entered).toBe(1);
    expect(rep.body.data.completed).toBe(1);
    expect(rep.body.data.attribution.loyaltyPointsIssued).toBe(100);
    expect(rep.body.data.funnel.some((f: { nodeId: string; reached: number }) => f.nodeId === "a" && f.reached === 1)).toBe(true);
  });

  it("publish graph không hợp lệ -> 400 JOURNEY_INVALID", async () => {
    const badDef = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "c", type: "condition", config: { predicate: { kind: "lifecycle", equals: "vip" } } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "c" }, { from: "c", to: "x", branch: "yes" }], // thiếu nhánh no
    };
    const create = await http().post("/v1/journeys").send({ name: "bad", triggerType: "manual", definition: badDef });
    const jid = create.body.data.journey_id;
    const res = await http().post(`/v1/journeys/${jid}/publish`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("JOURNEY_INVALID");
  });

  it("event trigger: ingest order_completed → enroll journey event", async () => {
    const eventDef = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "event", eventName: "order_completed" } },
        { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 50 } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
    };
    const create = await http().post("/v1/journeys").send({ name: "welcome", triggerType: "event", triggerConfig: { eventName: "order_completed" }, definition: eventDef });
    const jid = create.body.data.journey_id;
    await http().post(`/v1/journeys/${jid}/publish`);
    await http().post(`/v1/journeys/${jid}/activate`);

    await buy("0906000009", 120000, "ev-1"); // ingest → event hook enroll (fire-and-forget)

    // Poll vì hook chạy nền không chặn 202.
    let total = 0;
    for (let i = 0; i < 20 && total !== 1; i++) {
      total = (await http().get(`/v1/journeys/${jid}/participants`)).body.meta.total;
      if (total !== 1) await new Promise((r) => setTimeout(r, 50));
    }
    expect(total).toBe(1);
    await http().post("/v1/journeys/tick").send({ limit: 100 });
    expect((await http().get(`/v1/journeys/${jid}/participants`)).body.data[0].status).toBe("completed");
  });

  it("activate khi chưa publish -> 409", async () => {
    const create = await http().post("/v1/journeys").send({ name: "np", triggerType: "manual", definition: segLoyaltyDef });
    const res = await http().post(`/v1/journeys/${create.body.data.journey_id}/activate`);
    expect(res.status).toBe(409);
  });
});
