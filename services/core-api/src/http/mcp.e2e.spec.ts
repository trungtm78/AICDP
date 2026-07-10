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

describe("MCP gateway — read-only / aggregate phi-PII", () => {
  it("manifest liệt kê tool (không lộ tool ghi)", async () => {
    const r = await withAuth(http().get("/v1/mcp/manifest"), ADMIN_KEY);
    expect(r.status).toBe(200);
    const names = r.body.data.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("get_insights");
    expect(names).toContain("preview_segment");
    expect(names).toContain("get_model_cards");
    expect(names.length).toBe(3); // chỉ 3 tool đọc/aggregate
  });

  it("preview_segment CHỈ trả count — KHÔNG lộ occIds (phi-PII)", async () => {
    const r = await withAuth(
      http().post("/v1/mcp/invoke").send({ tool: "preview_segment", args: { lifecycleStage: "vip" } }),
      ADMIN_KEY,
    );
    expect(r.status).toBe(200);
    expect(typeof r.body.data.count).toBe("number");
    expect(r.body.data.occIds).toBeUndefined(); // KHÔNG lộ danh sách occId
  });

  it("get_insights trả số liệu tổng hợp (phi-PII)", async () => {
    const r = await withAuth(http().post("/v1/mcp/invoke").send({ tool: "get_insights" }), ADMIN_KEY);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveProperty("lifecycle");
    expect(r.body.data).toHaveProperty("revenueByBrand");
  });

  it("tool không hợp lệ -> 400 (không thực thi tuỳ tiện)", async () => {
    const r = await withAuth(http().post("/v1/mcp/invoke").send({ tool: "drop_table" }), ADMIN_KEY);
    expect(r.status).toBe(400);
  });

  it("KHÔNG token -> 401 (deny-by-default)", async () => {
    const r = await http().get("/v1/mcp/manifest");
    expect(r.status).toBe(401);
  });
});
