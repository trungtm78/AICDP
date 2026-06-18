import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { setConfig } from "../ai-config/ai-config.service.js";
import { __setProvider } from "./llm.gateway.js";
import { explainCustomer, nlToSegment, generateContent, askAssistant } from "./assistant.service.js";

// Fake provider: KHÔNG gọi mạng. Trả output điều khiển được + token giả để kiểm ghi usage.
let lastPrompt = "";
beforeAll(async () => {
  await setupTestDb();
  __setProvider("anthropic", async (opts) => {
    lastPrompt = `${opts.system}\n${opts.user}`;
    // segment task: trả JSON hợp lệ; còn lại trả text.
    const text = opts.system.includes("SegmentCriteria")
      ? '{"lifecycleStage":"vip","minSpend":1000000}'
      : "Đây là diễn giải/nội dung mẫu cho khách.";
    return { text, inputTokens: 11, outputTokens: 7 };
  });
});
beforeEach(async () => {
  await truncateAll();
});

async function seedCustomer(phone: string): Promise<string> {
  const r = await ingestOrderCompleted(pool, {
    brand_id: "givral", store_id: "s1", source: "pos", occ_timestamp: "2026-06-10T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: `A-${phone}`, total: 100000, items: [] },
  } as never);
  return r.occId!;
}

describe("LLM assistant — generative (fake provider, no network)", () => {
  it("explain: diễn giải khách + ghi ai_llm_usage", async () => {
    const occ = await seedCustomer("0900000001");
    const r = await explainCustomer(pool, occ, "user:test");
    expect(r.text.length).toBeGreaterThan(0);
    const usage = await pool.query<{ n: string; task: string }>(
      "SELECT count(*)::text AS n, max(task) AS task FROM cdp.ai_llm_usage",
    );
    expect(Number(usage.rows[0]!.n)).toBe(1);
    expect(usage.rows[0]!.task).toBe("explain");
  });

  it("explain: KHÔNG gửi PII (tên/sđt) vào prompt — guardrail", async () => {
    const occ = await seedCustomer("0900000002");
    await explainCustomer(pool, occ, "user:test");
    expect(lastPrompt).not.toContain("0900000002"); // sđt không lọt vào prompt
  });

  it("nlToSegment: LLM -> JSON SegmentCriteria validate -> preview", async () => {
    await seedCustomer("0900000003");
    const r = await nlToSegment(pool, "khách VIP chi tiêu trên 1 triệu", "user:test");
    expect(r.criteria.lifecycleStage).toBe("vip");
    expect(r.preview).toHaveProperty("count");
  });

  it("generateContent: trả text + ghi usage task=content", async () => {
    const r = await generateContent(pool, { brief: "Khuyến mãi bánh trung thu", channel: "email" }, "user:test");
    expect(r.text.length).toBeGreaterThan(0);
    const u = await pool.query<{ task: string }>("SELECT task FROM cdp.ai_llm_usage ORDER BY id DESC LIMIT 1");
    expect(u.rows[0]!.task).toBe("content");
  });

  it("ask: NLQ trả text dựa số liệu tổng hợp", async () => {
    await seedCustomer("0900000004");
    const r = await askAssistant(pool, "Hệ thống có bao nhiêu khách?", "user:test");
    expect(r.text.length).toBeGreaterThan(0);
  });

  it("features.assistant=false -> LLM_DISABLED", async () => {
    await setConfig(pool, "features", { assistant: false }, "admin");
    await expect(askAssistant(pool, "test", "user:test")).rejects.toMatchObject({ code: "LLM_DISABLED" });
  });
});
