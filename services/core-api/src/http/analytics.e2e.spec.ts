import "reflect-metadata";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createApp } from "./app.factory.js";
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

describe("analytics HTTP", () => {
  it("GET /v1/analytics/overview trả KPI (brands seed = 5)", async () => {
    const res = await request(app.getHttpServer()).get("/v1/analytics/overview");
    expect(res.status).toBe(200);
    expect(res.body.data.brands).toBe(5);
    expect(res.body.data).toHaveProperty("customers");
    expect(res.body.data).toHaveProperty("revenue");
    expect(res.body.data).toHaveProperty("loyaltyAvailable");
    expect(res.body.data).toHaveProperty("activationAllowed");
  });
});
