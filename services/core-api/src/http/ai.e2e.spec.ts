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
  await ensureKey("t-steward", "data_steward", "key-steward-ai");
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await truncateAll();
});

const srv = () => request(app.getHttpServer());
const bearer = (t: ReturnType<typeof srv>, k = ADMIN_KEY) => t.set("Authorization", `Bearer ${k}`);

async function buy(phone: string, skus: string[], txn: string): Promise<string> {
  const r = await bearer(srv().post("/v1/ingest")).send({
    type: "order_completed",
    brand_id: "givral",
    store_id: "s1",
    source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: {
      pos_transaction_id: txn,
      total: 1000,
      items: skus.map((sku) => ({ sku, name: `Tên ${sku}` })),
    },
  });
  return r.body.data.occId as string;
}

describe("ai HTTP — cross-sell", () => {
  it("trả gợi ý next-best-product cho khách", async () => {
    const a = await buy("0904000001", ["P1", "P2"], "ai-1");
    await buy("0904000002", ["P1", "P3"], "ai-2");

    const res = await bearer(srv().get("/v1/ai/recommendations")).query({ occId: a });
    expect(res.status).toBe(200);
    const skus = res.body.data.recommendations.map((r: { sku: string }) => r.sku);
    expect(skus).toContain("P3");
    expect(skus).not.toContain("P1");
  });

  it("RBAC: data_steward không được xem gợi ý -> 403", async () => {
    const res = await bearer(srv().get("/v1/ai/recommendations"), "key-steward-ai").query({
      occId: "00000000-0000-0000-0000-000000000000",
    });
    expect(res.status).toBe(403);
  });
});
