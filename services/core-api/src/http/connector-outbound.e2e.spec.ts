import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { withAuth, ADMIN_KEY } from "../test-helpers/auth.js";
import { pool } from "../db/pool.js";
import { createConnection, createConnector } from "../connector/connector.service.js";
import { deliverToConnection, deliverActivationRun } from "../connector/outbound.service.js";
import { registerOutbound } from "../connector/adapters/registry.js";
import type { OutboundMessage, OutboundDeps } from "../connector/adapters/types.js";

// Phase 4 Task 4.1 — OUTBOUND thật: deliverToConnection + POST /connections/:id/test-send.
// Fake adapter cho endpoint (không mạng); webhook adapter thật qua deliverToConnection + tiêm fetch.

let outStatus: "sent" | "failed" = "sent";
let lastMsg: OutboundMessage | null = null;
registerOutbound({
  key: "dst_test_out",
  deliver: async (_c, m) => { lastMsg = m; return outStatus === "sent" ? { status: "sent", providerMessageId: "prov-1" } : { status: "failed", error: "boom" }; },
  healthCheck: async () => ({ ok: true }),
});
// Adapter ném ngoài ý muốn -> deliverToConnection phải bắt + ghi 'failed' (không sập).
registerOutbound({
  key: "dst_throw_out",
  deliver: async () => { throw new Error("unexpected adapter crash"); },
  healthCheck: async () => ({ ok: true }),
});

const PUB_IP = "93.184.216.34";
const lookup = async () => [PUB_IP];
const fetchDeps = (status: number): OutboundDeps => ({
  lookup,
  fetchImpl: (async () => ({ status, text: async () => "ok" }) as unknown as Response) as typeof fetch,
});

let app: INestApplication;
beforeAll(async () => { await setupTestDb(); app = await createApp(); await app.init(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await truncateAll(); outStatus = "sent"; lastMsg = null; });
const http = () => request(app.getHttpServer());

async function mkTestOut(): Promise<string> {
  await createConnector(pool, { key: "dst_test_out", name: "Test Out", direction: "destination", category: "test", transport: "rest" });
  const c = await createConnection(pool, { name: "t", direction: "destination", connectorKey: "dst_test_out" });
  return c.id;
}

describe("deliverToConnection (service)", () => {
  it("webhook adapter thật + fetch 2xx -> sent, ghi connector_delivery", async () => {
    const c = await createConnection(pool, { name: "wh", direction: "destination", connectorKey: "dst_webhook", config: { webhookUrl: "https://hooks.example.com/x" } });
    const msg: OutboundMessage = { channel: "webhook", payload: { a: 1 }, occId: null as unknown as undefined };
    const r = await deliverToConnection(pool, c.id, msg, fetchDeps(200));
    expect(r.status).toBe("sent");
    const d = await pool.query("SELECT status, channel FROM cdp.connector_delivery WHERE connection_id=$1", [c.id]);
    expect(d.rowCount).toBe(1);
    expect(d.rows[0]!.status).toBe("sent");
  });

  it("webhook adapter + fetch 5xx -> failed, ghi delivery failed", async () => {
    const c = await createConnection(pool, { name: "wh", direction: "destination", connectorKey: "dst_webhook", config: { webhookUrl: "https://hooks.example.com/x" } });
    const r = await deliverToConnection(pool, c.id, { channel: "webhook", payload: {} }, fetchDeps(500));
    expect(r.status).toBe("failed");
    const d = await pool.query("SELECT status FROM cdp.connector_delivery WHERE connection_id=$1", [c.id]);
    expect(d.rows[0]!.status).toBe("failed");
  });

  it("adapter ném exception -> bắt lại, ghi delivery failed (không sập cả lô)", async () => {
    await createConnector(pool, { key: "dst_throw_out", name: "Throw", direction: "destination", category: "test", transport: "rest" });
    const c = await createConnection(pool, { name: "th", direction: "destination", connectorKey: "dst_throw_out" });
    const r = await deliverToConnection(pool, c.id, { channel: "x", payload: {} });
    expect(r.status).toBe("failed");
    const d = await pool.query("SELECT status FROM cdp.connector_delivery WHERE connection_id=$1", [c.id]);
    expect(d.rows[0]!.status).toBe("failed");
  });

  it("id không tồn tại -> NOT_FOUND", async () => {
    await expect(deliverToConnection(pool, "00000000-0000-0000-0000-000000000000", { channel: "x", payload: {} }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("connection là source -> CONNECTOR_MISCONFIGURED", async () => {
    const c = await createConnection(pool, { name: "s", direction: "source", connectorKey: "src_webhook", config: {} });
    await expect(deliverToConnection(pool, c.id, { channel: "x", payload: {} }))
      .rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("destination chưa có adapter -> INTEGRATION_NOT_AVAILABLE", async () => {
    const c = await createConnection(pool, { name: "m", direction: "destination", connectorKey: "dst_meta_ads", config: {} });
    await expect(deliverToConnection(pool, c.id, { channel: "x", payload: {} }))
      .rejects.toMatchObject({ code: "INTEGRATION_NOT_AVAILABLE" });
  });
});

// Seed 1 activation_run + member(allowed) kèm profile (phone tuỳ chọn).
async function seedRun(channel: string, phones: Array<string | null>): Promise<string> {
  const run = await pool.query<{ run_id: string }>(
    `INSERT INTO cdp.activation_run (audience_name, purpose, channel, destination, total, allowed_count, suppressed_count)
     VALUES ('Aud','marketing_zalo',$1,'dst',$2,$2,0) RETURNING run_id`,
    [channel, phones.length],
  );
  const runId = run.rows[0]!.run_id;
  for (const phone of phones) {
    const occ = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
    const occId = occ.rows[0]!.occ_id;
    await pool.query("INSERT INTO cdp.profile (occ_id, phone) VALUES ($1,$2)", [occId, phone]);
    await pool.query("INSERT INTO cdp.activation_member (run_id, occ_id, decision) VALUES ($1,$2,'allowed')", [runId, occId]);
  }
  return runId;
}

describe("deliverActivationRun (wiring activation → outbound)", () => {
  it("giao cho member allowed -> ghi delivery gắn run_id", async () => {
    const connId = await mkTestOut();
    const runId = await seedRun("webhook", ["0900000001", "0900000002"]);
    const r = await deliverActivationRun(pool, runId, connId);
    expect(r).toMatchObject({ total: 2, sent: 2, failed: 0, skipped: 0 });
    const d = await pool.query("SELECT count(*)::int n FROM cdp.connector_delivery WHERE run_id=$1", [runId]);
    expect(d.rows[0]!.n).toBe(2);
  });

  it("member không có contact + kênh messaging (Zalo) -> skipped_no_contact", async () => {
    const c = await createConnection(pool, { name: "z", direction: "destination", connectorKey: "dst_zalo_zns", config: { apiKey: "tok", templateId: "t1" } });
    const runId = await seedRun("zalo_zns", [null]); // không phone
    const r = await deliverActivationRun(pool, runId, c.id);
    expect(r.skipped).toBe(1);
    expect(r.sent).toBe(0);
  });

  it("run không tồn tại -> NOT_FOUND", async () => {
    const connId = await mkTestOut();
    await expect(deliverActivationRun(pool, "00000000-0000-0000-0000-000000000000", connId))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("POST /v1/activation/:runId/deliver (endpoint)", () => {
  it("marketer giao audience -> 200 summary", async () => {
    const connId = await mkTestOut();
    const runId = await seedRun("webhook", ["0900000001"]);
    const r = await withAuth(http().post(`/v1/activation/${runId}/deliver`).send({ connectionId: connId }), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data.sent).toBe(1);
  });
});

describe("POST /connections/:id/test-send (endpoint)", () => {
  it("gửi thử qua adapter -> 200 sent + ghi delivery, deliveries endpoint thấy", async () => {
    const id = await mkTestOut();
    const r = await withAuth(http().post(`/v1/connections/${id}/test-send`).send({ payload: { hi: 1 } }), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("sent");
    expect(lastMsg?.payload).toEqual({ hi: 1 });
    const d = await withAuth(http().get(`/v1/connections/${id}/deliveries`), ADMIN_KEY);
    expect(d.body.data).toHaveLength(1);
    expect(d.body.data[0].status).toBe("sent");
    expect(d.body.data[0].providerMessageId).toBe("prov-1");
  });

  it("adapter báo failed -> 200 + delivery failed (không ném)", async () => {
    const id = await mkTestOut();
    outStatus = "failed";
    const r = await withAuth(http().post(`/v1/connections/${id}/test-send`).send({}), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("failed");
  });

  it("không auth -> 401", async () => {
    const id = await mkTestOut();
    const r = await http().post(`/v1/connections/${id}/test-send`).send({});
    expect(r.status).toBe(401);
  });

  it("test-send tới source -> 400 CONNECTOR_MISCONFIGURED", async () => {
    const c = await withAuth(http().post("/v1/connections").send({ name: "s", direction: "source", connectorKey: "src_webhook", config: {} }), ADMIN_KEY);
    const r = await withAuth(http().post(`/v1/connections/${c.body.data.id}/test-send`).send({}), ADMIN_KEY);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
  });
});
