import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ADMIN_KEY, ensureKey } from "../test-helpers/auth.js";

let app: INestApplication;

beforeAll(async () => {
  await setupTestDb();
  app = await createApp();
  await app.init();
  await ensureKey("t-mkt-ai", "marketer", "key-mkt-ai");
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await truncateAll();
});

const srv = () => request(app.getHttpServer());
const bearer = (t: ReturnType<typeof srv>, k = ADMIN_KEY) => t.set("Authorization", `Bearer ${k}`);

async function buy(phone: string, txn: string, total = 1000): Promise<string> {
  const r = await bearer(srv().post("/v1/ingest")).send({
    type: "order_completed", brand_id: "givral", store_id: "s1", source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: txn, total, items: [{ sku: "P1", name: "P1" }] },
  });
  return r.body.data.occId as string;
}

describe("AI Config & Governance HTTP", () => {
  it("admin GET /v1/ai/config -> DEFAULTS (llm.defaultProvider=anthropic)", async () => {
    const res = await bearer(srv().get("/v1/ai/config"));
    expect(res.status).toBe(200);
    expect(res.body.data.llm.defaultProvider).toBe("anthropic");
  });

  it("admin POST đổi config -> ghi audit; GET audit trả lịch sử", async () => {
    const up = await bearer(srv().post("/v1/ai/config")).send({ section: "reco", value: { topN: 7 } });
    expect(up.status).toBe(200);
    expect(up.body.data.reco.topN).toBe(7);
    const audit = await bearer(srv().get("/v1/ai/config/audit"));
    expect(audit.body.data.length).toBeGreaterThanOrEqual(1);
    expect(audit.body.data[0].key).toBe("reco");
  });

  it("RBAC: marketer GET /v1/ai/config -> 403 (chỉ admin)", async () => {
    const res = await bearer(srv().get("/v1/ai/config"), "key-mkt-ai");
    expect(res.status).toBe(403);
  });

  it("section không hợp lệ -> 400", async () => {
    const res = await bearer(srv().post("/v1/ai/config")).send({ section: "khong_co", value: {} });
    expect(res.status).toBe(400);
  });
});

describe("Feature & NBA HTTP", () => {
  it("recompute feature (admin) rồi GET feature trả RFM", async () => {
    const occ = await buy("0905000001", "f-1");
    const rec = await bearer(srv().post("/v1/ai/features/recompute")).send({ occId: occ });
    expect(rec.status).toBe(200);
    expect(rec.body.data.frequency).toBe(1);
    const f = await bearer(srv().get(`/v1/ai/features/${occ}`));
    expect(f.status).toBe(200);
    expect(f.body.data.occId).toBe(occ);
  });

  it("GET feature khi chưa recompute -> 404 CUSTOMER_NOT_FOUND", async () => {
    const occ = await buy("0905000002", "f-2");
    const f = await bearer(srv().get(`/v1/ai/features/${occ}`));
    expect(f.status).toBe(404);
    expect(f.body.error.code).toBe("CUSTOMER_NOT_FOUND");
  });

  it("POST /v1/ai/nba trả quyết định có action + reasons", async () => {
    const occ = await buy("0905000003", "f-3");
    const res = await bearer(srv().post("/v1/ai/nba")).send({ occId: occ });
    expect(res.status).toBe(200);
    expect(res.body.data.action).toBeTruthy();
    expect(Array.isArray(res.body.data.reasons)).toBe(true);
  });
});
