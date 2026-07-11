import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { AppError } from "../http/errors.js";
import { createConnection, createConnector } from "./connector.service.js";
import { connectorByKey } from "./catalog.js";
import { issueInboundToken, resolveInboundConnection } from "./inbound.service.js";
import { testConnection } from "./health.service.js";
import { registerOutbound } from "./adapters/registry.js";
import type { HealthResult } from "./adapters/types.js";

// Fake adapter điều khiển được cho health-check.
let hc: () => Promise<HealthResult> = async () => ({ ok: true });
registerOutbound({ key: "test_hc", deliver: async () => ({ status: "sent" }), healthCheck: () => hc() });

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); hc = async () => ({ ok: true }); });

async function mk(direction: "source" | "destination", connectorKey: string): Promise<string> {
  // Key ngoài catalog -> đăng ký custom connector trước (createConnection nay validate key tồn tại).
  if (!connectorByKey(connectorKey)) {
    await createConnector(pool, { key: connectorKey, name: connectorKey, direction, category: "test", transport: "rest" });
  }
  const c = await createConnection(pool, { name: "t", direction, connectorKey });
  return c.id;
}

describe("inbound.service · token cổng vào", () => {
  it("issueInboundToken (source) -> resolve đúng token thành công", async () => {
    const id = await mk("source", "src_webhook");
    const raw = await issueInboundToken(pool, id);
    expect(raw).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const r = await resolveInboundConnection(pool, id, raw);
    expect(r.id).toBe(id);
    expect(r.connectorKey).toBe("src_webhook");
  });

  it("token sai -> CONNECTOR_UNAUTHORIZED", async () => {
    const id = await mk("source", "src_webhook");
    await issueInboundToken(pool, id);
    await expect(resolveInboundConnection(pool, id, "sai-token")).rejects.toMatchObject({ code: "CONNECTOR_UNAUTHORIZED" });
  });

  it("chưa cấp token -> unauthorized", async () => {
    const id = await mk("source", "src_webhook");
    await expect(resolveInboundConnection(pool, id, "x")).rejects.toBeInstanceOf(AppError);
  });

  it("connection paused -> unauthorized (không nhận)", async () => {
    const id = await mk("source", "src_webhook");
    const raw = await issueInboundToken(pool, id);
    await pool.query("UPDATE cdp.connection SET status='paused' WHERE id=$1", [id]);
    await expect(resolveInboundConnection(pool, id, raw)).rejects.toMatchObject({ code: "CONNECTOR_UNAUTHORIZED" });
  });

  it("cấp token cho destination -> NOT_FOUND (chỉ source)", async () => {
    const id = await mk("destination", "dst_webhook");
    await expect(issueInboundToken(pool, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("health.service · testConnection", () => {
  it("adapter ok -> status active + last_checked_at set", async () => {
    const id = await mk("destination", "test_hc");
    const r = await testConnection(pool, id);
    expect(r).toEqual({ ok: true, status: "active" });
    const row = await pool.query<{ status: string; last_checked_at: string | null }>(
      "SELECT status, last_checked_at FROM cdp.connection WHERE id=$1", [id]);
    expect(row.rows[0]!.status).toBe("active");
    expect(row.rows[0]!.last_checked_at).not.toBeNull();
  });

  it("adapter báo lỗi -> status error + last_error", async () => {
    hc = async () => ({ ok: false, error: "401 unauthorized" });
    const id = await mk("destination", "test_hc");
    const r = await testConnection(pool, id);
    expect(r.status).toBe("error");
    const row = await pool.query<{ status: string; last_error: string }>(
      "SELECT status, last_error FROM cdp.connection WHERE id=$1", [id]);
    expect(row.rows[0]!.status).toBe("error");
    expect(row.rows[0]!.last_error).toBe("401 unauthorized");
  });

  it("adapter ném exception -> status error; client KHÔNG thấy chi tiết thô, last_error giữ server-side", async () => {
    hc = async () => { throw new Error("connect ETIMEDOUT 10.0.0.5:6379"); };
    const id = await mk("destination", "test_hc");
    const r = await testConnection(pool, id);
    expect(r.status).toBe("error");
    expect(r.error).not.toContain("10.0.0.5"); // KHÔNG lộ IP nội bộ ra client
    const row = await pool.query<{ last_error: string }>("SELECT last_error FROM cdp.connection WHERE id=$1", [id]);
    expect(row.rows[0]!.last_error).toContain("ETIMEDOUT"); // chi tiết chỉ ở DB (server-side)
  });

  it("connector không có adapter -> INTEGRATION_NOT_AVAILABLE", async () => {
    const id = await mk("destination", "dst_unknown_xyz");
    await expect(testConnection(pool, id)).rejects.toMatchObject({ code: "INTEGRATION_NOT_AVAILABLE" });
  });

  it("connection không tồn tại -> NOT_FOUND", async () => {
    await expect(testConnection(pool, "00000000-0000-0000-0000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
