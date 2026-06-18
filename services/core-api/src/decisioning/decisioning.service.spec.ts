import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recordConsent } from "../consent/consent.service.js";
import { recomputeFeature } from "../feature/feature.service.js";
import { decideNBA } from "./decisioning.service.js";
import { DEFAULT_AI_CONFIG } from "../ai-config/ai-config.service.js";

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
    properties: { pos_transaction_id: `D-${n}`, total, items: [] },
  };
}
const ing = (o: unknown) => ingestOrderCompleted(pool, o as never);

async function seedVip(phone: string): Promise<string> {
  let occ = "";
  for (let i = 0; i < 5; i++) occ = (await ing(order(phone, "2026-06-15T03:00:00.000Z", 1_200_000)))!.occId!;
  await recomputeFeature(pool, occ, NOW);
  return occ;
}
async function seedAtRisk(phone: string): Promise<string> {
  // recency ~70 ngày (2026-04-09) -> at_risk (atRisk 60, dormant 90)
  let occ = "";
  occ = (await ing(order(phone, "2026-04-09T03:00:00.000Z", 200_000)))!.occId!;
  await ing(order(phone, "2026-04-09T04:00:00.000Z", 200_000));
  await recomputeFeature(pool, occ, NOW);
  return occ;
}

describe("decisioning — NBA (rule + consent gate)", () => {
  it("VIP -> loyalty_bonus (không cần consent)", async () => {
    const occ = await seedVip("0900000001");
    const d = await decideNBA(pool, occ, DEFAULT_AI_CONFIG);
    expect(d.lifecycleStage).toBe("vip");
    expect(d.action.type).toBe("loyalty_bonus");
    expect(d.eligible).toBe(true);
  });

  it("at_risk + CHƯA consent -> fallback loyalty_bonus, consentChecked.allowed=false", async () => {
    const occ = await seedAtRisk("0900000002");
    const d = await decideNBA(pool, occ, DEFAULT_AI_CONFIG);
    expect(d.lifecycleStage).toBe("at_risk");
    expect(d.action.type).toBe("loyalty_bonus");
    expect(d.consentChecked).toEqual({ purpose: "marketing_email", allowed: false });
  });

  it("at_risk + ĐÃ consent email -> offer qua email", async () => {
    const occ = await seedAtRisk("0900000003");
    await recordConsent(pool, { occId: occ, purpose: "marketing_email", status: "granted", source: "csr" });
    const d = await decideNBA(pool, occ, DEFAULT_AI_CONFIG);
    expect(d.action.type).toBe("offer");
    if (d.action.type === "offer") expect(d.action.channel).toBe("email");
    expect(d.consentChecked).toEqual({ purpose: "marketing_email", allowed: true });
  });

  it("decisioning tắt -> action none, không eligible", async () => {
    const occ = await seedVip("0900000004");
    const cfg = { ...DEFAULT_AI_CONFIG, decisioning: { enabled: false } };
    const d = await decideNBA(pool, occ, cfg);
    expect(d.action.type).toBe("none");
    expect(d.eligible).toBe(false);
  });
});
