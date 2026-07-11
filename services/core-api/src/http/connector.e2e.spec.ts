import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { withAuth, ADMIN_KEY } from "../test-helpers/auth.js";

let app: INestApplication;
beforeAll(async () => { await setupTestDb(); app = await createApp(); await app.init(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await truncateAll(); });
const http = () => request(app.getHttpServer());

async function mkConn(body: Record<string, unknown>): Promise<string> {
  const r = await withAuth(http().post("/v1/connections").send(body), ADMIN_KEY);
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

describe("connector endpoints — vận hành thật", () => {
  it("tạo connection có secret -> API trả MASK (không plaintext)", async () => {
    const r = await withAuth(
      http().post("/v1/connections").send({
        name: "Zalo", direction: "destination", connectorKey: "dst_zalo_zns",
        config: { oaId: "oa1", apiKey: "zalo-secret-9999" },
      }),
      ADMIN_KEY,
    );
    expect(r.status).toBe(201);
    expect(r.body.data.config.apiKey).toBe("••••9999");
    expect(JSON.stringify(r.body)).not.toContain("zalo-secret");
  });

  it("cấp token cổng vào (source) reveal 1 lần + events rỗng", async () => {
    const id = await mkConn({ name: "hook", direction: "source", connectorKey: "src_webhook" });
    const tok = await withAuth(http().post(`/v1/connections/${id}/inbound-token`), ADMIN_KEY);
    expect(tok.status).toBe(201);
    expect(typeof tok.body.data.token).toBe("string");

    const ev = await withAuth(http().get(`/v1/connections/${id}/events`), ADMIN_KEY);
    expect(ev.status).toBe(200);
    expect(ev.body.data).toEqual([]);
  });

  it("data-summary trả cấu trúc đếm (0 khi chưa có luồng)", async () => {
    const id = await mkConn({ name: "hook", direction: "source", connectorKey: "src_webhook" });
    const r = await withAuth(http().get(`/v1/connections/${id}/data-summary`), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data.events.total).toBe(0);
    expect(r.body.data.deliveries.total).toBe(0);
  });

  it("test connector CHƯA có adapter -> 400 INTEGRATION_NOT_AVAILABLE (honest, không giả success)", async () => {
    const id = await mkConn({ name: "meta", direction: "destination", connectorKey: "dst_meta_ads" });
    const r = await withAuth(http().post(`/v1/connections/${id}/test`), ADMIN_KEY);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("INTEGRATION_NOT_AVAILABLE");
  });

  it("không auth -> 401", async () => {
    const r = await http().get("/v1/connections/x/events");
    expect(r.status).toBe(401);
  });
});
