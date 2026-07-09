import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { enroll, tick } from "./journey-engine.service.js";
import { createDraft, publish, activateJourney } from "./journey-admin.service.js";
import { journeyReport } from "./journey-report.service.js";
import type { JourneyDefinition } from "./journey.types.js";

const def: JourneyDefinition = {
  nodes: [
    { id: "e", type: "entry", config: { trigger: "manual" } },
    { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 100 } },
    { id: "x", type: "exit" },
  ],
  edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
};

let occs: string[];

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  occs = [];
  for (let i = 0; i < 3; i++) {
    const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
    occs.push(r.rows[0]!.occ_id);
  }
});

async function makeJourney(): Promise<string> {
  const j = await createDraft(pool, { name: "rpt", triggerType: "manual", definition: def });
  await publish(pool, j.journey_id, "test");
  await activateJourney(pool, j.journey_id);
  return j.journey_id;
}

async function buyAfterEnroll(occ: string, total: number, txn: string, days = 0): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, store_id, source, pos_transaction_id, total, occ_timestamp, items)
     VALUES ($2,$1,'givral','s1','pos',$2,$3, now() + make_interval(days => $4, mins => 1), '[]')`,
    [occ, txn, total, days],
  );
}

describe("Journey report", () => {
  it("funnel + counts + attribution + enrollment/day", async () => {
    const jid = await makeJourney();
    for (const o of occs) expect((await enroll(pool, jid, o)).enrolled).toBe(true);
    await tick(pool);
    // 2 khách phát sinh đơn trong window; 1 khách đơn ngoài window (30 ngày) → không tính.
    await buyAfterEnroll(occs[0]!, 50000, "t0");
    await buyAfterEnroll(occs[1]!, 50000, "t1");
    await buyAfterEnroll(occs[2]!, 99999, "t2-out", 30);

    const rep = await journeyReport(pool, jid, 7);
    expect(rep.entered).toBe(3);
    expect(rep.completed).toBe(3);
    expect(rep.active).toBe(0);

    const byNode = Object.fromEntries(rep.funnel.map((f) => [f.nodeId, f.reached]));
    expect(byNode.e).toBe(3); // entry
    expect(byNode.a).toBe(3); // action reached
    expect(byNode.x).toBe(3); // exit = completed

    expect(rep.attribution.orders).toBe(2);
    expect(rep.attribution.revenue).toBe(100000);
    expect(rep.attribution.convertedCustomers).toBe(2);
    expect(rep.attribution.loyaltyPointsIssued).toBe(300); // 3 × 100
    expect(rep.attribution.activationsAllowed).toBe(0);

    expect(rep.enrollmentByDay).toHaveLength(1);
    expect(rep.enrollmentByDay[0]!.count).toBe(3);
  });

  it("windowDays thu hẹp loại đơn ngoài cửa sổ", async () => {
    const jid = await makeJourney();
    await enroll(pool, jid, occs[0]!);
    await tick(pool);
    await buyAfterEnroll(occs[0]!, 50000, "t0", 3); // 3 ngày sau
    expect((await journeyReport(pool, jid, 7)).attribution.orders).toBe(1);
    expect((await journeyReport(pool, jid, 1)).attribution.orders).toBe(0); // window 1 ngày loại
  });

  it("report rỗng khi chưa enroll", async () => {
    const jid = await makeJourney();
    const rep = await journeyReport(pool, jid, 7);
    expect(rep.entered).toBe(0);
    expect(rep.attribution.orders).toBe(0);
    expect(rep.funnel.find((f) => f.nodeId === "e")!.reached).toBe(0);
  });
});
