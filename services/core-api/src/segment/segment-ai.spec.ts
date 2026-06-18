import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recordConsent } from "../consent/consent.service.js";
import { recomputeFeature } from "../feature/feature.service.js";
import { previewSegment } from "./segment.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

const NOW = new Date("2026-06-18T00:00:00.000Z");
let n = 0;
function order(phone: string, ts: string, total: number) {
  n++;
  return {
    brand_id: "givral", store_id: "s1", source: "pos", occ_timestamp: ts,
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: `SG-${n}`, total, items: [] },
  };
}
const ing = (o: unknown) => ingestOrderCompleted(pool, o as never);

// Khách VIP: 5 đơn gần đây tổng >5tr. Khách churned: 1 đơn rất cũ.
async function seedVip(phone: string): Promise<string> {
  let occ = "";
  for (let i = 0; i < 5; i++) {
    occ = (await ing(order(phone, "2026-06-15T03:00:00.000Z", 1_200_000)))!.occId!;
  }
  await recomputeFeature(pool, occ, NOW);
  return occ;
}
async function seedChurned(phone: string): Promise<string> {
  const occ = (await ing(order(phone, "2025-10-01T03:00:00.000Z", 100_000)))!.occId!;
  // 2 đơn để frequency>1 (không bị 'new')
  await ing(order(phone, "2025-10-02T03:00:00.000Z", 100_000));
  await recomputeFeature(pool, occ, NOW);
  return occ;
}

describe("segment — tiêu chí AI (lifecycle/recency/consent)", () => {
  it("lifecycleStage='vip' chỉ lấy khách VIP", async () => {
    const vip = await seedVip("0900000001");
    await seedChurned("0900000002");
    const seg = await previewSegment(pool, { lifecycleStage: "vip" });
    expect(seg.occIds).toContain(vip);
    expect(seg.count).toBe(1);
  });

  it("maxRecencyDays nhỏ chỉ lấy khách gần đây", async () => {
    const vip = await seedVip("0900000003"); // recency ~3 ngày
    const churned = await seedChurned("0900000004"); // recency > 200 ngày
    const seg = await previewSegment(pool, { maxRecencyDays: 30 });
    expect(seg.occIds).toContain(vip);
    expect(seg.occIds).not.toContain(churned);
  });

  it("consentPurpose chỉ lấy khách đã granted (latest-wins)", async () => {
    const a = await seedVip("0900000005");
    const b = await seedVip("0900000006");
    await recordConsent(pool, { occId: a, purpose: "marketing_email", status: "granted", source: "csr" });
    await recordConsent(pool, { occId: b, purpose: "marketing_email", status: "granted", source: "csr" });
    await recordConsent(pool, { occId: b, purpose: "marketing_email", status: "withdrawn", source: "csr" }); // b rút
    const seg = await previewSegment(pool, { lifecycleStage: "vip", consentPurpose: "marketing_email" });
    expect(seg.occIds).toContain(a);
    expect(seg.occIds).not.toContain(b);
  });

  it("không tiêu chí feature -> tương thích ngược (không JOIN customer_feature)", async () => {
    const vip = await seedVip("0900000007");
    const seg = await previewSegment(pool, { minSpend: 1 });
    expect(seg.occIds).toContain(vip); // chạy như cũ dù chưa chắc đã recompute
  });
});
