import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { runNlqPlan, nlqPlanSchema } from "./nlq.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

async function order(phone: string, brand: string, txn: string, total: number) {
  return ingestOrderCompleted(pool, {
    brand_id: brand, store_id: "s1", source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: phone }],
    properties: { pos_transaction_id: txn, total },
  });
}

describe("NLQ — text-to-metric an toàn (chỉ SELECT, whitelist)", () => {
  it("plan schema chỉ chấp nhận enum whitelist", () => {
    expect(nlqPlanSchema.safeParse({ metric: "revenue", dimension: "brand" }).success).toBe(true);
    expect(nlqPlanSchema.safeParse({ metric: "drop_table" }).success).toBe(false);
    expect(nlqPlanSchema.safeParse({ metric: "revenue", dimension: "'; DROP" }).success).toBe(false);
  });

  it("revenue theo brand -> nhóm đúng, SQL chỉ SELECT", async () => {
    await order("0901000001", "givral", "t1", 300000);
    await order("0901000002", "givral", "t2", 200000);
    await order("0901000003", "fuji", "t3", 100000);

    const res = await runNlqPlan(pool, { metric: "revenue", dimension: "brand" });
    expect(res.chartType).toBe("bar");
    expect(res.sql.trim().toUpperCase().startsWith("SELECT")).toBe(true);
    const givral = res.rows.find((r) => r.label === "givral");
    expect(givral?.value).toBe(500000);
  });

  it("metric tổng (dimension none) -> single value", async () => {
    await order("0901000001", "givral", "t1", 300000);
    await order("0901000002", "fuji", "t2", 100000);
    const res = await runNlqPlan(pool, { metric: "orders", dimension: "none" });
    expect(res.chartType).toBe("single");
    expect(res.rows[0]!.value).toBe(2);
  });

  it("dimension month -> chartType line", async () => {
    await order("0901000001", "givral", "t1", 300000);
    const res = await runNlqPlan(pool, { metric: "revenue", dimension: "month" });
    expect(res.chartType).toBe("line");
  });
});
