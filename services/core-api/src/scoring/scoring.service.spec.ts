import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { scoreCustomer, type LifecycleStage } from "./scoring.service.js";
import { DEFAULT_AI_CONFIG } from "../ai-config/ai-config.service.js";

const cfg = DEFAULT_AI_CONFIG.rfm; // vipFreq5, vipMonetary5tr, atRisk60, dormant90, churn180

describe("scoring — lifecycle (heuristic deterministic)", () => {
  it("frequency ≤ 1 -> new", () => {
    expect(scoreCustomer({ recencyDays: 5, frequency: 1, monetary: 100 }, cfg).lifecycleStage).toBe("new");
    expect(scoreCustomer({ recencyDays: null, frequency: 0, monetary: 0 }, cfg).lifecycleStage).toBe("new");
  });

  it("recency ≥ churnGap -> churned (kể cả khách từng mua nhiều)", () => {
    expect(scoreCustomer({ recencyDays: 200, frequency: 10, monetary: 9_000_000 }, cfg).lifecycleStage).toBe("churned");
  });

  it("frequency ≥ vipFreq và monetary ≥ vipMonetary và còn hoạt động -> vip", () => {
    expect(scoreCustomer({ recencyDays: 10, frequency: 6, monetary: 6_000_000 }, cfg).lifecycleStage).toBe("vip");
  });

  it("dormant (90..180) và at_risk (60..90) phân biệt đúng", () => {
    expect(scoreCustomer({ recencyDays: 120, frequency: 3, monetary: 1_000_000 }, cfg).lifecycleStage).toBe("dormant");
    expect(scoreCustomer({ recencyDays: 70, frequency: 3, monetary: 1_000_000 }, cfg).lifecycleStage).toBe("at_risk");
  });

  it("gần đây + thường xuyên nhưng chưa đủ VIP -> active", () => {
    expect(scoreCustomer({ recencyDays: 10, frequency: 3, monetary: 500_000 }, cfg).lifecycleStage).toBe("active");
  });

  it("biên churnGap: đúng 180 -> churned; 179 -> không churned", () => {
    expect(scoreCustomer({ recencyDays: 180, frequency: 3, monetary: 100 }, cfg).lifecycleStage).toBe("churned");
    expect(scoreCustomer({ recencyDays: 179, frequency: 3, monetary: 100 }, cfg).lifecycleStage).not.toBe("churned");
  });

  it("churnRisk & propensity luôn trong [0,1]; reasons không rỗng", () => {
    const r = scoreCustomer({ recencyDays: 90, frequency: 4, monetary: 2_000_000 }, cfg);
    expect(r.churnRisk).toBeGreaterThanOrEqual(0);
    expect(r.churnRisk).toBeLessThanOrEqual(1);
    expect(r.propensityScore).toBeGreaterThanOrEqual(0);
    expect(r.propensityScore).toBeLessThanOrEqual(1);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("deterministic: cùng input -> cùng output", () => {
    const inp = { recencyDays: 45, frequency: 4, monetary: 3_000_000 };
    expect(scoreCustomer(inp, cfg)).toEqual(scoreCustomer(inp, cfg));
  });
});

describe("scoring — property (fast-check)", () => {
  const STAGES: LifecycleStage[] = ["new", "active", "at_risk", "vip", "dormant", "churned"];
  it("mọi input hợp lệ -> lifecycle ∈ enum, score ∈ [0,1]", () => {
    fc.assert(
      fc.property(
        fc.option(fc.integer({ min: 0, max: 2000 }), { nil: null }),
        fc.integer({ min: 0, max: 100 }),
        fc.integer({ min: 0, max: 100_000_000 }),
        (recencyDays, frequency, monetary) => {
          const r = scoreCustomer({ recencyDays, frequency, monetary }, cfg);
          expect(STAGES).toContain(r.lifecycleStage);
          expect(r.churnRisk).toBeGreaterThanOrEqual(0);
          expect(r.churnRisk).toBeLessThanOrEqual(1);
          expect(r.propensityScore).toBeGreaterThanOrEqual(0);
          expect(r.propensityScore).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 500 },
    );
  });
});
