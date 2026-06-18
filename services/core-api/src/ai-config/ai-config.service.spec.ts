import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import {
  getConfig,
  setConfig,
  listAudit,
  AiConfigError,
  DEFAULT_AI_CONFIG,
} from "./ai-config.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("ai-config — getConfig", () => {
  it("bảng rỗng -> trả nguyên DEFAULTS", async () => {
    const cfg = await getConfig(pool);
    expect(cfg).toEqual(DEFAULT_AI_CONFIG);
    expect(cfg.llm.defaultProvider).toBe("anthropic"); // CLAUDE.md: Claude mặc định
  });

  it("override một section -> merge nông trên DEFAULTS, section khác giữ nguyên", async () => {
    await setConfig(pool, "reco", { topN: 25, enableCrossBrand: false }, "admin");
    const cfg = await getConfig(pool);
    expect(cfg.reco.topN).toBe(25);
    expect(cfg.reco.enableCrossBrand).toBe(false);
    // field không override giữ default
    expect(cfg.reco.enableMarketBasket).toBe(DEFAULT_AI_CONFIG.reco.enableMarketBasket);
    // section khác không bị ảnh hưởng
    expect(cfg.rfm).toEqual(DEFAULT_AI_CONFIG.rfm);
  });
});

describe("ai-config — setConfig + audit", () => {
  it("section không hợp lệ -> AiConfigError UNKNOWN_SECTION", async () => {
    await expect(setConfig(pool, "khong_ton_tai", {}, "admin")).rejects.toMatchObject({
      code: "UNKNOWN_SECTION",
    });
  });

  it("ghi audit: lần đầu old_value null, lần sau old_value = giá trị trước", async () => {
    await setConfig(pool, "rfm", { churnGapDays: 200 }, "admin1");
    await setConfig(pool, "rfm", { churnGapDays: 150 }, "admin2");
    const audit = await listAudit(pool);
    expect(audit.length).toBe(2);
    // mới nhất trước
    expect(audit[0]!.changed_by).toBe("admin2");
    expect(audit[0]!.new_value).toMatchObject({ churnGapDays: 150 });
    expect(audit[0]!.old_value).toMatchObject({ churnGapDays: 200 });
    expect(audit[1]!.changed_by).toBe("admin1");
    expect(audit[1]!.old_value).toBeNull();
  });
});

describe("ai-config — audit append-only (DB chặn mutation)", () => {
  it("UPDATE bản ghi audit -> bị trigger chặn", async () => {
    await setConfig(pool, "reco", { topN: 5 }, "admin");
    await expect(
      pool.query("UPDATE cdp.ai_config_audit SET changed_by='hacker'"),
    ).rejects.toThrow(/append-only/);
  });

  it("DELETE bản ghi audit -> bị trigger chặn", async () => {
    await setConfig(pool, "reco", { topN: 5 }, "admin");
    await expect(pool.query("DELETE FROM cdp.ai_config_audit")).rejects.toThrow(/append-only/);
  });
});
