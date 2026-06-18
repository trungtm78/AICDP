import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { earn, reserve } from "../loyalty/loyalty.service.js";
import { recordConsent } from "../consent/consent.service.js";
import { activate } from "../activation/activation.service.js";
import { getOverview } from "./analytics.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("analytics — Control Tower overview", () => {
  it("trống: 0 khách/giao dịch nhưng giữ 5 brand seed", async () => {
    const o = await getOverview(pool);
    expect(o.customers).toBe(0);
    expect(o.transactions).toBe(0);
    expect(o.revenue).toBe(0);
    expect(o.brands).toBe(5);
  });

  it("tổng hợp khách, doanh thu, điểm loyalty, activation từ dữ liệu thật", async () => {
    // 1 giao dịch có định danh -> tạo occId + transaction
    const r = await ingestOrderCompleted(pool, {
      brand_id: "givral",
      store_id: "s1",
      source: "pos",
      occ_timestamp: "2026-06-18T03:00:00.000Z",
      identifiers: [{ type: "phone", value: "0901234567" }],
      properties: { pos_transaction_id: "AN-1", total: 250000 },
    });
    const occId = r.occId!;

    await earn(pool, { occId, points: 500, idempotencyKey: "an-earn" });
    await reserve(pool, { occId, points: 200, idempotencyKey: "an-res" });
    await recordConsent(pool, { occId, purpose: "marketing_email", status: "granted", source: "web" });
    await activate(pool, {
      audienceName: "a",
      purpose: "marketing_email",
      channel: "email",
      destination: "rudderstack",
      occIds: [occId],
    });

    const o = await getOverview(pool);
    expect(o.customers).toBe(1);
    expect(o.transactions).toBe(1);
    expect(o.revenue).toBe(250000);
    expect(o.loyaltyAvailable).toBe(300); // 500 - 200 giữ
    expect(o.loyaltyReserved).toBe(200);
    expect(o.activationAllowed).toBe(1);
    expect(o.activationSuppressed).toBe(0);
  });
});
