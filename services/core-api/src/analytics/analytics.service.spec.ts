import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { chReachable, testCh, setupTestCh, truncateCh } from "../test-helpers/ch.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { projectOrderBestEffort } from "../clickhouse/project.js";
import { earn, reserve } from "../loyalty/loyalty.service.js";
import { recordConsent } from "../consent/consent.service.js";
import { activate } from "../activation/activation.service.js";
import { getOverview, getBrandRevenue } from "./analytics.service.js";

const CH_UP = await chReachable();

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("analytics — Control Tower overview", () => {
  it("trống: 0 khách/giao dịch nhưng giữ 6 brand seed", async () => {
    const o = await getOverview(pool);
    expect(o.customers).toBe(0);
    expect(o.transactions).toBe(0);
    expect(o.revenue).toBe(0);
    expect(o.brands).toBe(6);
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

  it("CH down (client lỗi) -> getOverview vẫn chạy, fallback Postgres", async () => {
    await ingestOrderCompleted(pool, {
      brand_id: "givral",
      store_id: "s1",
      source: "pos",
      occ_timestamp: "2026-06-18T03:00:00.000Z",
      identifiers: [{ type: "phone", value: "0901234567" }],
      properties: { pos_transaction_id: "FB-1", total: 70000 },
    });
    // Client CH trỏ cổng chết -> getTxAggregate ném -> fallback PG (transactions/revenue từ PG).
    const { createCh } = await import("../clickhouse/client.js");
    const deadCh = createCh({ url: "http://127.0.0.1:1", requestTimeoutMs: 800 });
    const o = await getOverview(pool, deadCh);
    expect(o.transactions).toBe(1);
    expect(o.revenue).toBe(70000);
    await deadCh.close();
  });
});

describe.skipIf(!CH_UP)("analytics — nguồn ClickHouse (OLAP)", () => {
  beforeAll(async () => {
    await setupTestDb();
    await setupTestCh();
  });
  beforeEach(async () => {
    await truncateAll();
    await truncateCh();
  });

  it("transactions + revenue lấy TỪ ClickHouse khi có client", async () => {
    const r = await ingestOrderCompleted(pool, {
      brand_id: "givral",
      store_id: "s1",
      source: "pos",
      occ_timestamp: "2026-06-18T03:00:00.000Z",
      identifiers: [{ type: "phone", value: "0901234567" }],
      properties: { pos_transaction_id: "CH-1", total: 250000 },
    });
    await projectOrderBestEffort(testCh(), {
      brand_id: "givral",
      store_id: "s1",
      source: "pos",
      occ_timestamp: "2026-06-18T03:00:00.000Z",
      properties: { pos_transaction_id: "CH-1", total: 250000 },
    }, r.messageId, r.occId);

    const o = await getOverview(pool, testCh());
    expect(o.transactions).toBe(1);
    expect(o.revenue).toBe(250000);

    const byBrand = await getBrandRevenue(testCh());
    expect(byBrand.find((b) => b.brandId === "givral")?.revenue).toBe(250000);
  });
});
