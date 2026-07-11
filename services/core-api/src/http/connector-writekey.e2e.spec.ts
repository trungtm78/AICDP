import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { withAuth, ADMIN_KEY } from "../test-helpers/auth.js";
import { pool } from "../db/pool.js";
import { resetInboundLimiter } from "../connector/connector-inbound-ratelimit.js";

// Phase 2 Task 2.2 — cổng write-key shape Segment/RudderStack: @Public POST /v1/connectors/track.
// Xác thực writeKey (Basic auth chuẩn Segment | X-Write-Key), brand_id từ connection (chống spoof),
// map track "Order Completed"/identify -> pipeline ingest chuẩn.

let app: INestApplication;
beforeAll(async () => { await setupTestDb(); app = await createApp(); await app.init(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await truncateAll(); });
const http = () => request(app.getHttpServer());

const WK = "wk_test_12345";
async function mkSdkSource(): Promise<string> {
  const c = await withAuth(
    http().post("/v1/connections").send({
      name: "Web SDK", direction: "source", connectorKey: "src_js",
      config: { writeKey: WK, brand_id: "givral", store_id: "web" },
    }),
    ADMIN_KEY,
  );
  expect(c.status).toBe(201);
  return c.body.data.id as string;
}
const basic = (wk: string) => `Basic ${Buffer.from(`${wk}:`).toString("base64")}`;

describe("cổng write-key (shape Segment) — chạy thật", () => {
  it("track 'Order Completed' + Basic writeKey -> 202, lưu giao dịch brand từ connection", async () => {
    const id = await mkSdkSource();
    const r = await http()
      .post("/v1/connectors/track")
      .set("Authorization", basic(WK))
      .send({
        type: "track", event: "Order Completed", userId: "member-1",
        timestamp: "2026-07-11T09:00:00.000Z",
        properties: { order_id: "SEG-1", total: 199000, currency: "VND" },
      });
    expect(r.status).toBe(202);
    expect(r.body.data.type).toBe("order_completed");

    const tx = await pool.query(
      "SELECT brand_id, store_id FROM cdp.canonical_transaction WHERE message_id=$1",
      ["givral:web:SEG-1"],
    );
    expect(tx.rowCount).toBe(1);
    expect(tx.rows[0]!.brand_id).toBe("givral");

    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("ingested");
    expect(ev.body.data[0].eventType).toBe("order_completed");
  });

  it("identify + X-Write-Key header -> 202", async () => {
    await mkSdkSource();
    const r = await http()
      .post("/v1/connectors/track")
      .set("X-Write-Key", WK)
      .send({ type: "identify", userId: "member-1", traits: { email: "seg@ex.com", name: "Seg User" } });
    expect(r.status).toBe(202);
    expect(r.body.data.type).toBe("identify");
  });

  it("writeKey sai -> 401", async () => {
    await mkSdkSource();
    const r = await http()
      .post("/v1/connectors/track")
      .set("Authorization", basic("wk_wrong"))
      .send({ type: "identify", userId: "x" });
    expect(r.status).toBe(401);
  });

  it("thiếu writeKey -> 401", async () => {
    await mkSdkSource();
    const r = await http().post("/v1/connectors/track").send({ type: "identify", userId: "x" });
    expect(r.status).toBe(401);
  });

  it("writeKey TRÙNG ở >1 source active -> 401 (không định tuyến nhầm brand)", async () => {
    await mkSdkSource(); // connection 1, writeKey=WK
    await mkSdkSource(); // connection 2, cùng writeKey=WK -> va chạm
    const r = await http()
      .post("/v1/connectors/track")
      .set("X-Write-Key", WK)
      .send({ type: "identify", userId: "x" });
    expect(r.status).toBe(401);
  });

  it("track sự kiện không phải order (Product Viewed) -> 400 UNKNOWN_EVENT_TYPE + rejected", async () => {
    const id = await mkSdkSource();
    const r = await http()
      .post("/v1/connectors/track")
      .set("X-Write-Key", WK)
      .send({ type: "track", event: "Product Viewed", userId: "u", properties: { sku: "A" } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("UNKNOWN_EVENT_TYPE");
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });

  it("vượt rate-limit per-connection ở /track -> 429 + Retry-After", async () => {
    await mkSdkSource();
    process.env.CONNECTOR_INBOUND_BURST = "1";
    process.env.CONNECTOR_INBOUND_REFILL_PER_SEC = "0.001";
    resetInboundLimiter();
    try {
      const ok = await http().post("/v1/connectors/track").set("X-Write-Key", WK)
        .send({ type: "track", event: "Order Completed", userId: "u", properties: { order_id: "RL-T1", total: 1000 } });
      expect(ok.status).toBe(202);
      const blocked = await http().post("/v1/connectors/track").set("X-Write-Key", WK)
        .send({ type: "track", event: "Order Completed", userId: "u", properties: { order_id: "RL-T2", total: 1000 } });
      expect(blocked.status).toBe(429);
      expect(blocked.headers["retry-after"]).toBeDefined();
    } finally {
      delete process.env.CONNECTOR_INBOUND_BURST;
      delete process.env.CONNECTOR_INBOUND_REFILL_PER_SEC;
      resetInboundLimiter();
    }
  });

  it("track order thiếu order_id -> 400 (schema) + rejected", async () => {
    const id = await mkSdkSource();
    const r = await http()
      .post("/v1/connectors/track")
      .set("X-Write-Key", WK)
      .send({ type: "track", event: "Order Completed", userId: "u", properties: { total: 1000 } });
    expect(r.status).toBe(400);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });
});
