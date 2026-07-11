import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { withAuth, ADMIN_KEY } from "../test-helpers/auth.js";
import { pool } from "../db/pool.js";
import { resetInboundLimiter } from "../connector/connector-inbound-ratelimit.js";

// Phase 2 — cổng webhook INBOUND thật: @Public POST /v1/connectors/sources/:id/events.
// Xác thực X-Connector-Token (constant-time), brand_id LẤY TỪ connection (chống spoof),
// zod strict, ghi connector_event, chảy vào canonical_transaction qua ingest.

let app: INestApplication;
beforeAll(async () => { await setupTestDb(); app = await createApp(); await app.init(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await truncateAll(); });
const http = () => request(app.getHttpServer());

/** Tạo source connection (brand_id nhúng trong config) + cấp token cổng vào. */
async function mkSource(brandId = "givral", connectorKey = "src_webhook"): Promise<{ id: string; token: string }> {
  const c = await withAuth(
    http().post("/v1/connections").send({
      name: "POS hook", direction: "source", connectorKey,
      config: { webhookUrl: "https://pos.example.com/hook", brand_id: brandId },
    }),
    ADMIN_KEY,
  );
  expect(c.status).toBe(201);
  const id = c.body.data.id as string;
  const t = await withAuth(http().post(`/v1/connections/${id}/inbound-token`), ADMIN_KEY);
  expect(t.status).toBe(201);
  return { id, token: t.body.data.token as string };
}

const order = (posTxn: string, extra: Record<string, unknown> = {}) => ({
  type: "order_completed",
  store_id: "s1",
  occ_timestamp: "2026-07-11T10:00:00.000Z",
  identifiers: [{ type: "phone", value: "0900000001" }],
  properties: { pos_transaction_id: posTxn, total: 250000, currency: "VND" },
  ...extra,
});

describe("cổng webhook inbound — chạy thật", () => {
  it("token đúng + order_completed -> 202, ghi event ingested, lưu giao dịch với brand từ connection", async () => {
    const { id, token } = await mkSource("givral");
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send(order("POS-1"));
    expect(r.status).toBe(202);
    expect(r.body.data.accepted).toBe(true);

    // Giao dịch vào canonical_transaction với brand_id = givral (từ connection, KHÔNG từ payload).
    const tx = await pool.query(
      "SELECT brand_id, store_id, total FROM cdp.canonical_transaction WHERE message_id=$1",
      ["givral:s1:POS-1"],
    );
    expect(tx.rowCount).toBe(1);
    expect(tx.rows[0]!.brand_id).toBe("givral");

    // connector_event ghi nhận ingested.
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data).toHaveLength(1);
    expect(ev.body.data[0].status).toBe("ingested");
    expect(ev.body.data[0].eventType).toBe("order_completed");

    // data-summary phản ánh 1 event ingested.
    const ds = await withAuth(http().get(`/v1/connections/${id}/data-summary`), ADMIN_KEY);
    expect(ds.body.data.events.total).toBe(1);
    expect(ds.body.data.events.ingested).toBe(1);
  });

  it("token sai -> 401, KHÔNG ghi event, KHÔNG lưu giao dịch", async () => {
    const { id } = await mkSource();
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", "sai-token")
      .send(order("POS-X"));
    expect(r.status).toBe(401);
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
    const ev = await pool.query("SELECT count(*)::int n FROM cdp.connector_event WHERE connection_id=$1", [id]);
    expect(ev.rows[0]!.n).toBe(0);
  });

  it("thiếu token -> 401", async () => {
    const { id } = await mkSource();
    const r = await http().post(`/v1/connectors/sources/${id}/events`).send(order("POS-Y"));
    expect(r.status).toBe(401);
  });

  it("payload chứa brand_id (spoof) -> 400 fail-closed (zod strict) + ghi event rejected", async () => {
    const { id, token } = await mkSource("givral");
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send(order("POS-SPOOF", { brand_id: "fuji" }));
    expect(r.status).toBe(400);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data).toHaveLength(1);
    expect(ev.body.data[0].status).toBe("rejected");
  });

  it("pos_transaction_id chứa ':' (bẩn namespace) -> 400 + rejected", async () => {
    const { id, token } = await mkSource();
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send(order("A:B"));
    expect(r.status).toBe(400);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });

  it("payload thiếu pos_transaction_id -> 400 + event rejected (không nuốt im lặng)", async () => {
    const { id, token } = await mkSource();
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send({ type: "order_completed", store_id: "s1", properties: { total: 1000 } });
    expect(r.status).toBe(400);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });

  it("store_id chứa ':' (bẩn namespace message_id) -> 400 + rejected", async () => {
    const { id, token } = await mkSource("givral");
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send(order("POS-COLON", { store_id: "fuji:web1" }));
    expect(r.status).toBe(400);
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
  });

  it("identify webhook -> 202 + event ingested", async () => {
    const { id, token } = await mkSource();
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send({ type: "identify", identifiers: [{ type: "email", value: "a@b.com" }], traits: { full_name: "A" } });
    expect(r.status).toBe(202);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].eventType).toBe("identify");
    expect(ev.body.data[0].status).toBe("ingested");
  });

  it("nguồn VN (KiotViet-like) native payload + payloadMapping -> map & ingest, brand từ connection", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({
        name: "KiotViet", direction: "source", connectorKey: "src_kiotviet",
        config: {
          brand_id: "givral",
          payloadMapping: {
            eventType: "order_completed",
            store_id: "data.branch", pos_transaction_id: "data.code", total: "data.total",
            occ_timestamp: "data.buyDate", phone: "data.customer.phone",
          },
        },
      }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const t = await withAuth(http().post(`/v1/connections/${id}/inbound-token`), ADMIN_KEY);
    const token = t.body.data.token as string;
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send({ data: { code: "HD-9", total: 320000, branch: "kv1", buyDate: "2026-07-11T08:00:00Z", customer: { phone: "0900000009" } } });
    expect(r.status).toBe(202);
    const tx = await pool.query("SELECT brand_id, store_id, total FROM cdp.canonical_transaction WHERE message_id=$1", ["givral:kv1:HD-9"]);
    expect(tx.rowCount).toBe(1);
    expect(tx.rows[0]!.brand_id).toBe("givral");
    expect(Number(tx.rows[0]!.total)).toBe(320000);
  });

  it("connection direction=destination -> 401 (cổng vào chỉ cho source)", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "zalo", direction: "destination", connectorKey: "dst_zalo_zns", config: {} }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const tok = await withAuth(http().post(`/v1/connections/${id}/inbound-token`), ADMIN_KEY);
    // Không cấp được token cho destination.
    expect(tok.status).toBe(404);
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", "bat-ky")
      .send(order("POS-D"));
    expect(r.status).toBe(401);
  });

  it("type không hỗ trợ -> 400 UNKNOWN_EVENT_TYPE + event rejected", async () => {
    const { id, token } = await mkSource();
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send({ type: "page", name: "home" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("UNKNOWN_EVENT_TYPE");
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });

  it("order với identifier toàn sai chuẩn -> 400 INVALID_IDENTIFIER + rejected (không ghi giao dịch mồ côi)", async () => {
    const { id, token } = await mkSource();
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send(order("POS-BAD", { identifiers: [{ type: "phone", value: "khong-phai-so" }] }));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INVALID_IDENTIFIER");
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
  });

  it("vượt rate-limit per-connection -> 429 + Retry-After", async () => {
    const { id, token } = await mkSource();
    process.env.CONNECTOR_INBOUND_BURST = "1";
    process.env.CONNECTOR_INBOUND_REFILL_PER_SEC = "0.001";
    resetInboundLimiter();
    try {
      const ok = await http()
        .post(`/v1/connectors/sources/${id}/events`)
        .set("X-Connector-Token", token)
        .send(order("RL-1"));
      expect(ok.status).toBe(202);
      const blocked = await http()
        .post(`/v1/connectors/sources/${id}/events`)
        .set("X-Connector-Token", token)
        .send(order("RL-2"));
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe("CONNECTOR_RATE_LIMIT");
      expect(blocked.headers["retry-after"]).toBeDefined();
    } finally {
      delete process.env.CONNECTOR_INBOUND_BURST;
      delete process.env.CONNECTOR_INBOUND_REFILL_PER_SEC;
      resetInboundLimiter();
    }
  });

  it("connection thiếu brand_id trong config -> 400 CONNECTOR_MISCONFIGURED + event rejected", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "hook2", direction: "source", connectorKey: "src_webhook", config: { webhookUrl: "https://x.example.com" } }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const t = await withAuth(http().post(`/v1/connections/${id}/inbound-token`), ADMIN_KEY);
    const token = t.body.data.token as string;
    const r = await http()
      .post(`/v1/connectors/sources/${id}/events`)
      .set("X-Connector-Token", token)
      .send(order("POS-NB"));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });
});
