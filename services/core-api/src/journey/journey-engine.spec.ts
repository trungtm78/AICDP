import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { validateDefinition, enroll, tick, enrollSegment } from "./journey-engine.service.js";
import { createDraft, publish, activateJourney, getJourney, listParticipants, retryParticipant } from "./journey-admin.service.js";
import { getBalance } from "../loyalty/loyalty.service.js";
import { recordConsent } from "../consent/consent.service.js";
import { getRun } from "../activation/activation.service.js";
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

async function makeFeature(occ: string, f: Partial<{ lifecycle: string; churn: number; propensity: number; loyalty: number; favCat: string }>): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.customer_feature (occ_id, lifecycle_stage, churn_risk, propensity_score, loyalty_available, favorite_category)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (occ_id) DO UPDATE SET lifecycle_stage=EXCLUDED.lifecycle_stage, churn_risk=EXCLUDED.churn_risk,
       propensity_score=EXCLUDED.propensity_score, loyalty_available=EXCLUDED.loyalty_available, favorite_category=EXCLUDED.favorite_category`,
    [occ, f.lifecycle ?? null, f.churn ?? null, f.propensity ?? null, f.loyalty ?? 0, f.favCat ?? null],
  );
}

/** Tạo journey draft → publish → activate; trả journey_id. */
async function makeActiveJourney(def: JourneyDefinition, trigger: "manual" | "segment" | "event" = "manual", triggerConfig: Record<string, unknown> = {}): Promise<string> {
  const j = await createDraft(pool, { name: "test-journey", triggerType: trigger, triggerConfig, definition: def });
  await publish(pool, j.journey_id, "test");
  const act = await activateJourney(pool, j.journey_id);
  expect(act?.status).toBe("active");
  return j.journey_id;
}

describe("Journey engine — validate", () => {
  it("reject: thiếu entry", () => {
    expect(() => validateDefinition({ nodes: [{ id: "x", type: "exit" }], edges: [] })).toThrow(/entry/);
  });
  it("reject: thiếu exit", () => {
    expect(() => validateDefinition({ nodes: [{ id: "e", type: "entry", config: { trigger: "manual" } }], edges: [] })).toThrow(/exit/);
  });
  it("reject: condition thiếu nhánh", () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "c", type: "condition", config: { predicate: { kind: "lifecycle", equals: "vip" } } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "c" }, { from: "c", to: "x", branch: "yes" }],
    };
    expect(() => validateDefinition(def)).toThrow(/yes\/no/);
  });
  it("reject: cycle", () => {
    // Cardinality hợp lệ (mỗi node 1 cạnh ra) nhưng a→w→a là vòng lặp.
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 10 } },
        { id: "w", type: "wait", config: { delayMinutes: 1 } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "a" }, { from: "a", to: "w" }, { from: "w", to: "a" }],
    };
    expect(() => validateDefinition(def)).toThrow(/cycle|vòng/i);
  });
  it("reject: condition predicate không hợp lệ", () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "c", type: "condition", config: { predicate: { kind: "khong_co" } } as never },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "c" }, { from: "c", to: "x", branch: "yes" }, { from: "c", to: "x", branch: "no" }],
    };
    expect(() => validateDefinition(def)).toThrow(/predicate/);
  });
  it("reject: node action có >1 cạnh ra", () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 10 } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }, { from: "a", to: "e" }],
    };
    expect(() => validateDefinition(def)).toThrow(/đúng 1 cạnh/);
  });
  it("accept: graph hợp lệ", () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 50 } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
    };
    expect(() => validateDefinition(def)).not.toThrow();
  });
});

const loyaltyDef: JourneyDefinition = {
  nodes: [
    { id: "e", type: "entry", config: { trigger: "manual" } },
    { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 100 } },
    { id: "x", type: "exit" },
  ],
  edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
};

describe("Journey engine — chạy", () => {
  it("action loyalty_bonus → complete + cộng điểm", async () => {
    const jid = await makeActiveJourney(loyaltyDef);
    const en = await enroll(pool, jid, occId);
    expect(en.enrolled).toBe(true);
    const t = await tick(pool);
    expect(t.processed).toBeGreaterThanOrEqual(2); // action + exit
    const bal = await getBalance(pool, occId);
    expect(bal.available).toBe(100);
    const { rows } = await listParticipants(pool, jid, {});
    expect(rows[0]!.status).toBe("completed");
  });

  it("enroll once-ever: lần 2 bị dedupe", async () => {
    const jid = await makeActiveJourney(loyaltyDef);
    expect((await enroll(pool, jid, occId)).enrolled).toBe(true);
    expect((await enroll(pool, jid, occId)).enrolled).toBe(false);
    const { total } = await listParticipants(pool, jid, {});
    expect(total).toBe(1);
  });

  it("wait: hoãn trước node kế", async () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "w", type: "wait", config: { delayMinutes: 60 } },
        { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 100 } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "w" }, { from: "w", to: "a" }, { from: "a", to: "x" }],
    };
    const jid = await makeActiveJourney(def);
    await enroll(pool, jid, occId);
    await tick(pool);
    expect((await getBalance(pool, occId)).available).toBe(0); // đang chờ wait
    const p = (await listParticipants(pool, jid, {})).rows[0]!;
    expect(p.status).toBe("active");
    // ép hết hạn wait
    await pool.query("UPDATE cdp.journey_participant SET next_run_at=now() WHERE status='active'");
    await tick(pool);
    expect((await getBalance(pool, occId)).available).toBe(100);
    expect((await listParticipants(pool, jid, {})).rows[0]!.status).toBe("completed");
  });

  it("condition: rẽ nhánh theo lifecycle", async () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "c", type: "condition", config: { predicate: { kind: "lifecycle", equals: "vip" } } },
        { id: "yes", type: "action", config: { kind: "loyalty_bonus", points: 500 } },
        { id: "no", type: "action", config: { kind: "loyalty_bonus", points: 10 } },
        { id: "x", type: "exit" },
      ],
      edges: [
        { from: "e", to: "c" },
        { from: "c", to: "yes", branch: "yes" },
        { from: "c", to: "no", branch: "no" },
        { from: "yes", to: "x" },
        { from: "no", to: "x" },
      ],
    };
    await makeFeature(occId, { lifecycle: "vip" });
    const jid = await makeActiveJourney(def);
    await enroll(pool, jid, occId);
    await tick(pool);
    expect((await getBalance(pool, occId)).available).toBe(500); // nhánh vip
  });

  it("action activation: gate consent (suppress khi chưa granted, allowed khi granted)", async () => {
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "manual" } },
        { id: "a", type: "action", config: { kind: "activation", purpose: "marketing_email", channel: "email", destination: "test" } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
    };
    const jid = await makeActiveJourney(def);
    // occ1 chưa consent → suppressed
    await enroll(pool, jid, occId);
    // occ2 đã granted → allowed
    const r2 = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
    const occ2 = r2.rows[0]!.occ_id;
    await recordConsent(pool, { occId: occ2, purpose: "marketing_email", status: "granted", source: "api" });
    await enroll(pool, jid, occ2);
    await tick(pool);
    // đọc step_run activation của mỗi participant
    const steps = await pool.query<{ occ_id: string; result: { activationRunId: string } }>(
      `SELECT p.occ_id, s.result FROM cdp.journey_step_run s
         JOIN cdp.journey_participant p ON p.id=s.participant_id
        WHERE s.node_type='action'`,
    );
    for (const st of steps.rows) {
      const run = await getRun(pool, st.result.activationRunId);
      if (st.occ_id === occ2) expect(run!.allowed_count).toBe(1);
      else expect(run!.suppressed_count).toBe(1);
    }
  });

  it("effectively-once: replay action không cộng trùng", async () => {
    const jid = await makeActiveJourney(loyaltyDef);
    const en = await enroll(pool, jid, occId);
    await tick(pool);
    expect((await getBalance(pool, occId)).available).toBe(100);
    // Giả lập crash: đưa participant về node action + active, XÓA step_run (advance chưa commit).
    await pool.query("DELETE FROM cdp.journey_step_run WHERE participant_id=$1 AND node_type='action'", [en.participantId]);
    await pool.query("UPDATE cdp.journey_participant SET status='active', current_node_id='a', completed_at=null, next_run_at=now() WHERE id=$1", [en.participantId]);
    await tick(pool);
    // earn idempotencyKey journey:{pid}:a → KHÔNG cộng lần 2.
    expect((await getBalance(pool, occId)).available).toBe(100);
  });

  it("retry participant failed → active", async () => {
    const jid = await makeActiveJourney(loyaltyDef);
    const en = await enroll(pool, jid, occId);
    await pool.query("UPDATE cdp.journey_participant SET status='failed', exit_reason='x' WHERE id=$1", [en.participantId]);
    expect(await retryParticipant(pool, en.participantId!)).toBe(true);
    const p = (await listParticipants(pool, jid, {})).rows[0]!;
    expect(p.status).toBe("active");
  });

  it("enroll bị chặn khi journey chưa active (draft)", async () => {
    const j = await createDraft(pool, { name: "d", triggerType: "manual", definition: loyaltyDef });
    await publish(pool, j.journey_id, "test");
    // chưa activate
    expect((await enroll(pool, j.journey_id, occId)).enrolled).toBe(false);
    expect((await getJourney(pool, j.journey_id))!.status).toBe("draft");
  });

  it("enrollSegment: enroll khách khớp segment", async () => {
    // occId có giao dịch để lọt segment minTransactions? Dùng segment rỗng (mọi occ có txn).
    // Tạo canonical_transaction cho occId để previewSegment trả về.
    await pool.query(
      `INSERT INTO cdp.canonical_transaction (message_id, occ_id, brand_id, store_id, source, pos_transaction_id, total, occ_timestamp, items)
       VALUES ('m1',$1,'givral','s1','pos','t1', 100, now(), '[]')`,
      [occId],
    );
    const def: JourneyDefinition = {
      nodes: [
        { id: "e", type: "entry", config: { trigger: "segment", segment: { minTransactions: 1 } } },
        { id: "a", type: "action", config: { kind: "loyalty_bonus", points: 20 } },
        { id: "x", type: "exit" },
      ],
      edges: [{ from: "e", to: "a" }, { from: "a", to: "x" }],
    };
    const jid = await makeActiveJourney(def, "segment", { segment: { minTransactions: 1 } });
    const n = await enrollSegment(pool, jid);
    expect(n).toBe(1);
    await tick(pool);
    expect((await getBalance(pool, occId)).available).toBe(20);
  });
});
