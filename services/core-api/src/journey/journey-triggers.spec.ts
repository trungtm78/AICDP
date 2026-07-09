import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { createDraft, publish, activateJourney, listParticipants } from "./journey-admin.service.js";
import { enrollEventJourneys, runSegmentEntry } from "./journey-triggers.service.js";
import { JourneyScheduler } from "./journey-scheduler.js";
import { getBalance } from "../loyalty/loyalty.service.js";
import type { JourneyDefinition } from "./journey.types.js";

let occId: string;

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  occId = r.rows[0]!.occ_id;
});

function eventDef(eventName: string): JourneyDefinition {
  return {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "event", eventName } },
      { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 50 } },
      { id: "x", type: "exit" },
    ],
    edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
  };
}
function segDef(): JourneyDefinition {
  return {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "segment", segment: { minTransactions: 1 } } },
      { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 20 } },
      { id: "x", type: "exit" },
    ],
    edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
  };
}

async function activeJourney(def: JourneyDefinition, trigger: "event" | "segment", cfg: Record<string, unknown>): Promise<string> {
  const j = await createDraft(pool, { name: "t", triggerType: trigger, triggerConfig: cfg, definition: def });
  await publish(pool, j.journey_id, "test");
  await activateJourney(pool, j.journey_id);
  return j.journey_id;
}

async function buy(occ: string, txn: string): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, store_id, source, pos_transaction_id, total, occ_timestamp, items)
     VALUES ($2,$1,'givral','s1','pos',$2, 100, now(), '[]')`,
    [occ, txn],
  );
}

describe("Journey triggers", () => {
  it("enrollEventJourneys: enroll journey event khớp eventName", async () => {
    const jid = await activeJourney(eventDef("order_completed"), "event", { eventName: "order_completed" });
    expect(await enrollEventJourneys(pool, occId, "order_completed")).toBe(1);
    expect((await listParticipants(pool, jid, {})).total).toBe(1);
  });

  it("enrollEventJourneys: KHÔNG khớp eventName → 0", async () => {
    await activeJourney(eventDef("cart_abandoned"), "event", { eventName: "cart_abandoned" });
    expect(await enrollEventJourneys(pool, occId, "order_completed")).toBe(0);
  });

  it("enrollEventJourneys: journey draft (chưa active) → 0", async () => {
    const j = await createDraft(pool, { name: "d", triggerType: "event", triggerConfig: { eventName: "order_completed" }, definition: eventDef("order_completed") });
    await publish(pool, j.journey_id, "test"); // chưa activate
    expect(await enrollEventJourneys(pool, occId, "order_completed")).toBe(0);
  });

  it("runSegmentEntry: enroll khách khớp segment các journey segment", async () => {
    await buy(occId, "t1");
    await activeJourney(segDef(), "segment", { segment: { minTransactions: 1 } });
    expect(await runSegmentEntry(pool)).toBe(1);
  });
});

describe("JourneyScheduler", () => {
  it("runOnce: tick advance participant + segment-scan (run đầu)", async () => {
    await buy(occId, "t1");
    await activeJourney(segDef(), "segment", { segment: { minTransactions: 1 } });
    const sched = new JourneyScheduler(pool);
    // run 0: runs%SEGMENT_EVERY==0 → segment scan enroll + tick chạy đến hoàn thành
    const r = await sched.runOnce();
    expect(r.enrolled).toBe(1);
    expect(r.processed).toBeGreaterThanOrEqual(1);
    expect((await getBalance(pool, occId)).available).toBe(20);
  });

  it("runOnce: single-flight (đang chạy → trả 0)", async () => {
    const sched = new JourneyScheduler(pool);
    // ép cờ running để mô phỏng lượt chồng
    (sched as unknown as { running: boolean }).running = true;
    const r = await sched.runOnce();
    expect(r).toEqual({ processed: 0, enrolled: 0 });
  });
});
