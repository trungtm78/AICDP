import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { withAuth, ADMIN_KEY } from "../test-helpers/auth.js";
import { pool } from "../db/pool.js";
import { buildVnpayHashData } from "../connector/payment/vnpay.js";
import { resetInboundLimiter } from "../connector/connector-inbound-ratelimit.js";

// Phase 3 Task 3.1 — cổng IPN VNPay: @Public POST/GET /v1/connectors/payment/:id/ipn.
// Verify checksum HMAC-SHA512 fail-closed, brand từ connection, map -> ingest, ACK định dạng VNPay.

let app: INestApplication;
const SECRET = "OCCVNPAYSECRET";
beforeAll(async () => { await setupTestDb(); app = await createApp(); await app.init(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await truncateAll(); });
const http = () => request(app.getHttpServer());

async function mkVnpay(): Promise<string> {
  const c = await withAuth(
    http().post("/v1/connections").send({
      name: "VNPay", direction: "source", connectorKey: "src_vnpay",
      config: { secretKey: SECRET, brand_id: "givral", store_id: "web1" },
    }),
    ADMIN_KEY,
  );
  expect(c.status).toBe(201);
  // API luôn mask secret -> KHÔNG lộ plaintext.
  expect(JSON.stringify(c.body)).not.toContain(SECRET);
  return c.body.data.id as string;
}

function signed(txnRef: string, amount: string, code = "00"): Record<string, string> {
  const p: Record<string, string> = {
    vnp_TxnRef: txnRef, vnp_Amount: amount, vnp_ResponseCode: code,
    vnp_TransactionStatus: code, vnp_BankCode: "NCB",
  };
  p["vnp_SecureHash"] = createHmac("sha512", SECRET).update(buildVnpayHashData(p), "utf8").digest("hex");
  return p;
}

describe("cổng IPN VNPay — chạy thật", () => {
  it("chữ ký hợp lệ + success -> RspCode 00, ingest giao dịch brand từ connection", async () => {
    const id = await mkVnpay();
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("PAY-1", "25000000"));
    expect(r.status).toBe(200);
    expect(r.body.RspCode).toBe("00");
    const tx = await pool.query(
      "SELECT brand_id, total, payment_method FROM cdp.canonical_transaction WHERE message_id=$1",
      ["givral:web1:PAY-1"],
    );
    expect(tx.rowCount).toBe(1);
    expect(tx.rows[0]!.brand_id).toBe("givral");
    expect(Number(tx.rows[0]!.total)).toBe(250000);
    expect(tx.rows[0]!.payment_method).toBe("vnpay");
  });

  it("chữ ký sai (giả mạo amount) -> RspCode 97, KHÔNG ingest, event rejected", async () => {
    const id = await mkVnpay();
    const p = signed("PAY-2", "25000000");
    p["vnp_Amount"] = "1"; // giả mạo sau khi ký
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(p);
    expect(r.body.RspCode).toBe("97");
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.body.data[0].status).toBe("rejected");
  });

  it("replay IPN hợp lệ -> idempotent (RspCode 00, không nhân đôi giao dịch)", async () => {
    const id = await mkVnpay();
    const p = signed("PAY-3", "10000000");
    await http().post(`/v1/connectors/payment/${id}/ipn`).send(p);
    const r2 = await http().post(`/v1/connectors/payment/${id}/ipn`).send(p);
    expect(r2.body.RspCode).toBe("00");
    expect(r2.body.Message).toContain("Already");
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction WHERE message_id=$1", ["givral:web1:PAY-3"]);
    expect(tx.rows[0]!.n).toBe(1);
  });

  it("giao dịch thất bại (ResponseCode 24) chữ ký đúng -> RspCode 00 nhận, KHÔNG ingest", async () => {
    const id = await mkVnpay();
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("PAY-4", "5000000", "24"));
    expect(r.body.RspCode).toBe("00");
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
  });

  it("VNPay gọi qua GET query -> vẫn xử lý", async () => {
    const id = await mkVnpay();
    const p = signed("PAY-5", "7000000");
    const r = await http().get(`/v1/connectors/payment/${id}/ipn`).query(p);
    expect(r.body.RspCode).toBe("00");
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction WHERE message_id=$1", ["givral:web1:PAY-5"]);
    expect(tx.rows[0]!.n).toBe(1);
  });

  it("connection không tồn tại -> 404", async () => {
    const r = await http().post(`/v1/connectors/payment/00000000-0000-0000-0000-000000000000/ipn`).send(signed("X", "1000000"));
    expect(r.status).toBe(404);
  });

  it("connector không phải cổng thanh toán -> 400", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "hook", direction: "source", connectorKey: "src_webhook", config: { brand_id: "givral" } }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("Y", "1000000"));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
  });

  it("thiếu secretKey trong config -> 400 CONNECTOR_MISCONFIGURED", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "vp", direction: "source", connectorKey: "src_vnpay", config: { brand_id: "givral" } }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("Z", "1000000"));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
  });

  it("thiếu brand_id trong config -> 400 CONNECTOR_MISCONFIGURED", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "vp", direction: "source", connectorKey: "src_vnpay", config: { secretKey: SECRET } }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("Z2", "1000000"));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
  });

  it("connection paused -> 400", async () => {
    const id = await mkVnpay();
    await withAuth(http().patch(`/v1/connections/${id}/status`).send({ status: "paused" }), ADMIN_KEY);
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("PZ", "1000000"));
    expect(r.status).toBe(400);
  });

  it("chữ ký đúng nhưng thiếu vnp_TxnRef -> RspCode 01", async () => {
    const id = await mkVnpay();
    const p: Record<string, string> = { vnp_Amount: "1000000", vnp_ResponseCode: "00", vnp_TransactionStatus: "00" };
    p["vnp_SecureHash"] = createHmac("sha512", SECRET).update(buildVnpayHashData(p), "utf8").digest("hex");
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(p);
    expect(r.body.RspCode).toBe("01");
  });

  it("amount <= 0 (chữ ký đúng, success) -> RspCode 04, không ingest", async () => {
    const id = await mkVnpay();
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("PA0", "0"));
    expect(r.body.RspCode).toBe("04");
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
  });

  it("cổng MoMo chưa hỗ trợ IPN -> 400 INTEGRATION_NOT_AVAILABLE", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "momo", direction: "source", connectorKey: "src_momo", config: { secretKey: SECRET, brand_id: "givral" } }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const r = await http().post(`/v1/connectors/payment/${id}/ipn`).send({ any: "x" });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INTEGRATION_NOT_AVAILABLE");
  });

  it("vượt rate-limit per-connection IPN -> 429", async () => {
    const id = await mkVnpay();
    process.env.CONNECTOR_INBOUND_BURST = "1";
    process.env.CONNECTOR_INBOUND_REFILL_PER_SEC = "0.001";
    resetInboundLimiter();
    try {
      const ok = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("RL1", "1000000"));
      expect(ok.body.RspCode).toBe("00");
      const blocked = await http().post(`/v1/connectors/payment/${id}/ipn`).send(signed("RL2", "1000000"));
      expect(blocked.status).toBe(429);
    } finally {
      delete process.env.CONNECTOR_INBOUND_BURST;
      delete process.env.CONNECTOR_INBOUND_REFILL_PER_SEC;
      resetInboundLimiter();
    }
  });
});
