import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeFeature } from "../feature/feature.service.js";
import { recordConsent } from "../consent/consent.service.js";
import { createOffer, arbitrate } from "./offer.service.js";
import { createExperiment, assignAll, computeUplift, variantFor } from "./experiment.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

async function order(phone: string, txn: string, total: number, ts = "2026-06-18T03:00:00.000Z") {
  return ingestOrderCompleted(pool, {
    brand_id: "givral", store_id: "s1", source: "pos", occ_timestamp: ts,
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: txn, total },
  });
}
async function setPrediction(occId: string, propensity: number) {
  await pool.query(
    `INSERT INTO cdp.customer_prediction (occ_id, propensity, score_source) VALUES ($1,$2,'heuristic')`,
    [occId, propensity],
  );
}

describe("decisioning — arbitration (expectedValue = propensity × baseValue)", () => {
  it("chọn offer expectedValue cao nhất, gate consent cho offer có purpose", async () => {
    const a = await order("0901000001", "t1", 300000);
    await recomputeFeature(pool, a.occId);
    await setPrediction(a.occId, 0.5);

    await createOffer(pool, { name: "Thưởng điểm", kind: "loyalty_bonus", baseValue: 100000 });     // EV=50k, không cần consent
    await createOffer(pool, { name: "Email -20%", kind: "activation", purpose: "marketing_email", channel: "email", baseValue: 400000 }); // EV=200k NHƯNG cần consent

    // Chưa consent email -> offer email không đủ ĐK -> winner = thưởng điểm
    const r1 = await arbitrate(pool, a.occId);
    expect(r1.winner?.name).toBe("Thưởng điểm");

    // Cấp consent email -> offer email đủ ĐK, EV cao hơn -> winner = email
    await recordConsent(pool, { occId: a.occId, purpose: "marketing_email", status: "granted", source: "web" });
    const r2 = await arbitrate(pool, a.occId);
    expect(r2.winner?.name).toBe("Email -20%");
    expect(r2.winner?.expectedValue).toBe(200000);
  });
});

describe("experiment — variant deterministic + uplift", () => {
  it("variantFor deterministic (cùng input -> cùng biến thể)", () => {
    const v1 = variantFor("exp-1", "occ-1", 20);
    const v2 = variantFor("exp-1", "occ-1", 20);
    expect(v1).toBe(v2);
    expect(["treatment", "holdout"]).toContain(v1);
  });

  it("assignAll + computeUplift chia treatment/holdout và đo chuyển đổi", async () => {
    // 10 khách có giao dịch (mốc cũ), rồi 1 số mua lại (chuyển đổi sau assign)
    for (let i = 0; i < 10; i++) await order(`090100${i.toString().padStart(4, "0")}`, `t${i}`, 100000, "2025-01-01T00:00:00.000Z");
    const exp = await createExperiment(pool, { name: "test", holdoutPct: 30 });
    const n = await assignAll(pool, exp.id);
    expect(n).toBe(10);
    const u = await computeUplift(pool, exp.id);
    expect(u.treatment.n + u.holdout.n).toBe(10);
    expect(u.treatment.rate).toBeGreaterThanOrEqual(0);
    expect(u.holdout.rate).toBeLessThanOrEqual(1);
  });
});
