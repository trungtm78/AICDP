import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { runCopilot } from "./copilot.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

describe("copilot.service — chuỗi human-in-the-loop", () => {
  it("LLM tắt: research OK, segment/content SKIPPED (không lỗi chuỗi), vẫn đề xuất journey", async () => {
    // Tắt assistant -> nlToSegment/generateContent ném LLM_DISABLED -> bước 'skipped'.
    await pool.query(
      `INSERT INTO cdp.ai_config (key, value, updated_by) VALUES ('features', '{"assistant":false}'::jsonb, 'test')
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    );
    const res = await runCopilot(pool, "chiến dịch win-back VIP", "test-principal");
    const byKey = Object.fromEntries(res.steps.map((s) => [s.key, s.status]));
    expect(byKey.research).toBe("ok"); // research không cần LLM
    expect(byKey.segment).toBe("skipped"); // LLM off -> skip, KHÔNG error
    expect(byKey.content).toBe("skipped");
    expect(byKey.journey).toBe("ok");
    // KHÔNG tự tạo journey — chỉ đề xuất (human-in-the-loop).
    expect(res.proposedJourney).not.toBeNull();
    expect(res.proposedJourney?.name).toContain("chiến dịch win-back VIP".slice(0, 10));
  });

  it("mỗi bước độc lập lỗi: chuỗi luôn hoàn tất 4 bước", async () => {
    const res = await runCopilot(pool, "brief bất kỳ", "p");
    expect(res.steps.length).toBe(4);
    expect(res.steps.map((s) => s.key)).toEqual(["research", "segment", "content", "journey"]);
  });
});
