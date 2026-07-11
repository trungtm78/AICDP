import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { withAuth, ADMIN_KEY } from "../test-helpers/auth.js";
import { pool } from "../db/pool.js";

// Phase 2 Task 2.3 — Postgres reverse-ETL puller: POST /v1/connections/:id/pull kéo dữ liệu từ
// kho quan hệ (SELECT-only + host-guard) rồi nạp vào CDP theo cursor. Test chạy THẬT: bảng nguồn
// tạm trong chính DB test (127.0.0.1) -> cần CONNECTOR_ALLOW_PRIVATE_PULL=1 (kho nội bộ self-host).

let app: INestApplication;
const DBCFG = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5433),
  database: process.env.PGDATABASE ?? "AI_CDP_Pro",
  user: process.env.PGUSER ?? "occ_cdp",
  apiKey: process.env.PGPASSWORD ?? "occ_cdp_dev",
};

beforeAll(async () => {
  await setupTestDb();
  process.env.CONNECTOR_ALLOW_PRIVATE_PULL = "1";
  app = await createApp();
  await app.init();
  await pool.query(`CREATE TABLE IF NOT EXISTS cdp.rev_src_orders (
    id bigserial PRIMARY KEY, txn text, amt numeric, phone text, ts timestamptz DEFAULT now())`);
});
afterAll(async () => {
  await pool.query("DROP TABLE IF EXISTS cdp.rev_src_orders");
  delete process.env.CONNECTOR_ALLOW_PRIVATE_PULL;
  await app.close();
});
beforeEach(async () => {
  await truncateAll();
  await pool.query("TRUNCATE cdp.rev_src_orders RESTART IDENTITY");
});
const http = () => request(app.getHttpServer());

async function mkPgSource(): Promise<string> {
  const c = await withAuth(
    http().post("/v1/connections").send({
      name: "Kho PG", direction: "source", connectorKey: "src_pg",
      config: {
        ...DBCFG, brand_id: "givral", store_id: "rev1",
        table: "cdp.rev_src_orders", cursorColumn: "id",
        mapping: { pos_transaction_id: "txn", total: "amt", phone: "phone", occ_timestamp: "ts" },
      },
    }),
    ADMIN_KEY,
  );
  expect(c.status).toBe(201);
  return c.body.data.id as string;
}

describe("reverse-ETL Postgres pull — chạy thật", () => {
  it("kéo các dòng mới -> nạp vào CDP + tiến cursor; lần 2 không còn dòng", async () => {
    const id = await mkPgSource();
    await pool.query(
      `INSERT INTO cdp.rev_src_orders (txn, amt, phone) VALUES ('R1',100000,'0900000001'),('R2',200000,'0900000002')`,
    );
    const r1 = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r1.status).toBe(200);
    expect(r1.body.data.pulled).toBe(2);
    expect(r1.body.data.ingested).toBe(2);

    const tx = await pool.query(
      "SELECT brand_id, store_id, total FROM cdp.canonical_transaction WHERE message_id=$1",
      ["givral:rev1:R1"],
    );
    expect(tx.rowCount).toBe(1);
    expect(tx.rows[0]!.brand_id).toBe("givral");
    expect(Number(tx.rows[0]!.total)).toBe(100000);

    // Lần 2: cursor đã tiến -> 0 dòng mới.
    const r2 = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r2.body.data.pulled).toBe(0);

    // Thêm 1 dòng mới -> lần 3 chỉ kéo dòng đó.
    await pool.query(`INSERT INTO cdp.rev_src_orders (txn, amt) VALUES ('R3',50000)`);
    const r3 = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r3.body.data.pulled).toBe(1);
    expect(r3.body.data.ingested).toBe(1);
  });

  it("dòng lỗi (thiếu txn) -> đếm rejected, không dừng cả lô; dòng tốt vẫn nạp", async () => {
    const id = await mkPgSource();
    await pool.query(`INSERT INTO cdp.rev_src_orders (txn, amt) VALUES ('OK1',10000),(NULL,20000)`);
    const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data.pulled).toBe(2);
    expect(r.body.data.ingested).toBe(1);
    expect(r.body.data.rejected).toBe(1);
    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    const statuses = (ev.body.data as Array<{ status: string }>).map((x) => x.status).sort();
    expect(statuses).toEqual(["ingested", "rejected"]);
  });

  it("connection là destination -> 400 CONNECTOR_MISCONFIGURED", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "wh", direction: "destination", connectorKey: "dst_webhook", config: {} }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
  });

  it("connector không có adapter pull -> 400 INTEGRATION_NOT_AVAILABLE", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({ name: "hook", direction: "source", connectorKey: "src_webhook", config: { brand_id: "givral" } }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INTEGRATION_NOT_AVAILABLE");
  });

  it("connection không tồn tại -> 404", async () => {
    const r = await withAuth(http().post(`/v1/connections/00000000-0000-0000-0000-000000000000/pull`), ADMIN_KEY);
    expect(r.status).toBe(404);
  });

  it("không auth -> 401", async () => {
    const id = await mkPgSource();
    const r = await http().post(`/v1/connections/${id}/pull`);
    expect(r.status).toBe(401);
  });
});
