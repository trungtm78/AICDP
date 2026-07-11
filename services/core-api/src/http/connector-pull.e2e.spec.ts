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

  it("dòng lỗi -> đếm rejected + DỪNG (không nhảy qua row lỗi); sửa nguồn rồi pull lại -> nạp được", async () => {
    const id = await mkPgSource();
    // OK1 (id1) hợp lệ, BAD (id2) thiếu txn -> rejected. Stop-at-failure: cursor chỉ tới id1.
    await pool.query(`INSERT INTO cdp.rev_src_orders (txn, amt) VALUES ('OK1',10000),(NULL,20000)`);
    const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data.ingested).toBe(1);
    expect(r.body.data.rejected).toBe(1);
    // Cursor KHÔNG nhảy qua row lỗi: dừng ở id1.
    const cur = await pool.query("SELECT pull_cursor FROM cdp.connection WHERE id=$1", [id]);
    expect(cur.rows[0]!.pull_cursor).toEqual({ value: "1" });
    // Sửa nguồn (row id2 giờ hợp lệ) -> pull lại nạp ĐƯỢC (không bị skip vĩnh viễn).
    await pool.query(`UPDATE cdp.rev_src_orders SET txn='FIXED2' WHERE id=2`);
    const r2 = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r2.body.data.ingested).toBe(1);
    const tx = await pool.query("SELECT 1 FROM cdp.canonical_transaction WHERE message_id=$1", ["givral:rev1:FIXED2"]);
    expect(tx.rowCount).toBe(1);
  });

  it("total NULL -> rejected (KHÔNG ép 0, không nuốt dữ liệu tiền)", async () => {
    const id = await mkPgSource();
    await pool.query(`INSERT INTO cdp.rev_src_orders (txn, amt) VALUES ('T-NULL', NULL)`);
    const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r.body.data.ingested).toBe(0);
    expect(r.body.data.rejected).toBe(1);
    const tx = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(tx.rows[0]!.n).toBe(0);
  });

  it("cursorColumn TRÙNG giá trị + tieBreakColumn -> keyset composite KHÔNG bỏ sót row", async () => {
    const c = await withAuth(
      http().post("/v1/connections").send({
        name: "PG tie", direction: "source", connectorKey: "src_pg",
        config: {
          ...DBCFG, brand_id: "givral", store_id: "rev1", batchSize: 2,
          table: "cdp.rev_src_orders", cursorColumn: "ts", tieBreakColumn: "id",
          mapping: { pos_transaction_id: "txn", total: "amt" },
        },
      }),
      ADMIN_KEY,
    );
    const id = c.body.data.id as string;
    // 4 row CÙNG ts; batch 2 -> nếu chỉ dùng ts sẽ skip 2 row còn lại. Có tie=id thì không.
    await pool.query(
      `INSERT INTO cdp.rev_src_orders (txn, amt, ts) VALUES
        ('D1',1,'2026-07-11T00:00:00Z'),('D2',1,'2026-07-11T00:00:00Z'),
        ('D3',1,'2026-07-11T00:00:00Z'),('D4',1,'2026-07-11T00:00:00Z')`,
    );
    const r1 = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r1.body.data.ingested).toBe(2);
    const r2 = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r2.body.data.ingested).toBe(2); // 2 row còn lại — KHÔNG bị skip
    const total = await pool.query("SELECT count(*)::int n FROM cdp.canonical_transaction");
    expect(total.rows[0]!.n).toBe(4);
  });

  it("connection paused -> 400 (chỉ pull khi active)", async () => {
    const id = await mkPgSource();
    await withAuth(http().patch(`/v1/connections/${id}/status`).send({ status: "paused" }), ADMIN_KEY);
    const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("CONNECTOR_MISCONFIGURED");
  });

  it("đang có pull khác giữ advisory-lock -> 409 CONNECTOR_PULL_BUSY", async () => {
    const id = await mkPgSource();
    const holder = await pool.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext($1))", [`connector-pull:${id}`]);
      const r = await withAuth(http().post(`/v1/connections/${id}/pull`), ADMIN_KEY);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("CONNECTOR_PULL_BUSY");
    } finally {
      await holder.query("SELECT pg_advisory_unlock(hashtext($1))", [`connector-pull:${id}`]);
      holder.release();
    }
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
