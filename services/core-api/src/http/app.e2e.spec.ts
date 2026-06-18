import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { pool } from "../db/pool.js";
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

describe("health", () => {
  it("GET /v1/health trả 200 ok", async () => {
    const res = await http().get("/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("masters", () => {
  it("GET /v1/brands trả 5 brand seed", async () => {
    const res = await http().get("/v1/brands");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(5);
    expect(res.body.data[0]).toHaveProperty("brand_id");
  });

  it("POST /v1/stores tạo store rồi GET /v1/stores?brand_id lọc đúng", async () => {
    const create = await http()
      .post("/v1/stores")
      .send({
        store_id: "givral-q1",
        brand_id: "givral",
        name: "Givral Quận 1",
        city: "HCM",
      });
    expect(create.status).toBe(201);

    const list = await http().get("/v1/stores").query({ brand_id: "givral" });
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].store_id).toBe("givral-q1");
  });

  it("POST /v1/stores thiếu field bắt buộc -> 400 + error envelope", async () => {
    const res = await http().post("/v1/stores").send({ name: "Thiếu id" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEMA_MISSING_REQUIRED_FIELD");
    expect(res.body.error).toHaveProperty("field_path");
    expect(res.body.error).toHaveProperty("correlation_id");
    expect(res.body.error.retryable).toBe(false);
  });

  it("POST /v1/products + GET /v1/products", async () => {
    const create = await http()
      .post("/v1/products")
      .send({ product_master_id: "pm-banh-1", name: "Bánh kem dâu" });
    expect(create.status).toBe(201);
    const list = await http().get("/v1/products");
    expect(list.body.data.some((p: any) => p.product_master_id === "pm-banh-1")).toBe(true);
  });
});

describe("ingest", () => {
  const order = (txn: string) => ({
    type: "order_completed",
    brand_id: "givral",
    store_id: "givral-q1",
    source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: "0901234567" }],
    properties: { pos_transaction_id: txn, total: 150000, currency: "VND" },
  });

  it("POST /v1/ingest order_completed tạo occ_id, lần 2 cùng txn -> idempotent", async () => {
    const r1 = await http().post("/v1/ingest").send(order("T-1"));
    expect(r1.status).toBe(202);
    expect(r1.body.data.idempotent).toBe(false);
    expect(r1.body.data.occId).toBeTruthy();

    const r2 = await http().post("/v1/ingest").send(order("T-1"));
    expect(r2.status).toBe(202);
    expect(r2.body.data.idempotent).toBe(true);
    expect(r2.body.data.occId).toBe(r1.body.data.occId);
  });

  it("POST /v1/ingest identify gắn traits (survivorship)", async () => {
    const res = await http()
      .post("/v1/ingest")
      .send({
        type: "identify",
        brand_id: "givral",
        identifiers: [{ type: "phone", value: "0907654321" }],
        traits: { full_name: "Nguyễn Văn A", city: "HCM" },
      });
    expect(res.status).toBe(202);
    expect(res.body.data.occId).toBeTruthy();
  });

  it("POST /v1/ingest type không hỗ trợ -> 400 UNKNOWN_EVENT_TYPE", async () => {
    const res = await http()
      .post("/v1/ingest")
      .send({ type: "page_viewed", brand_id: "givral" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("UNKNOWN_EVENT_TYPE");
  });

  it("order_completed có identifiers nhưng TẤT CẢ không hợp lệ -> 400 INVALID_IDENTIFIER (không nuốt im lặng)", async () => {
    const res = await http()
      .post("/v1/ingest")
      .send({
        type: "order_completed",
        brand_id: "givral",
        store_id: "givral-q1",
        source: "pos",
        occ_timestamp: "2026-06-18T03:00:00.000Z",
        identifiers: [{ type: "phone", value: "khong-phai-so" }],
        properties: { pos_transaction_id: "T-BAD", total: 1000 },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("identify với identifiers toàn không hợp lệ -> 400 INVALID_IDENTIFIER", async () => {
    const res = await http()
      .post("/v1/ingest")
      .send({
        type: "identify",
        brand_id: "givral",
        identifiers: [{ type: "email", value: "khong-phai-email" }],
        traits: { full_name: "X" },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_IDENTIFIER");
  });

  it("occ_timestamp sai định dạng -> 400 SCHEMA_TYPE_MISMATCH (không để pg ném 500)", async () => {
    const res = await http()
      .post("/v1/ingest")
      .send({
        type: "order_completed",
        brand_id: "givral",
        store_id: "givral-q1",
        source: "pos",
        occ_timestamp: "khong-phai-ngay",
        identifiers: [{ type: "phone", value: "0901234567" }],
        properties: { pos_transaction_id: "T-TS", total: 1000 },
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEMA_TYPE_MISMATCH");
  });

  it("JSON body hỏng -> 400 SCHEMA_TYPE_MISMATCH (không phải INTERNAL/500)", async () => {
    const res = await http()
      .post("/v1/ingest")
      .set("Content-Type", "application/json")
      .send('{"type":"order_completed", broken');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SCHEMA_TYPE_MISMATCH");
  });
});

describe("customer lookup", () => {
  it("GET /v1/customers/lookup trả Customer 360 sau khi ingest", async () => {
    await http()
      .post("/v1/ingest")
      .send({
        type: "order_completed",
        brand_id: "givral",
        store_id: "givral-q1",
        source: "pos",
        occ_timestamp: "2026-06-18T03:00:00.000Z",
        identifiers: [{ type: "phone", value: "0901112223" }],
        properties: { pos_transaction_id: "T-9", total: 99000 },
      });

    const res = await http()
      .get("/v1/customers/lookup")
      .query({ type: "phone", value: "0901112223" });
    expect(res.status).toBe(200);
    expect(res.body.data.occId).toBeTruthy();
    expect(res.body.data.transactions.length).toBe(1);
    expect(res.body.data.identifiers.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /v1/customers/lookup không tìm thấy -> 404", async () => {
    const res = await http()
      .get("/v1/customers/lookup")
      .query({ type: "phone", value: "0900000000" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("CUSTOMER_NOT_FOUND");
  });
});
