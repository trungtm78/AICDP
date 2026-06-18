import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { recordConsent } from "../consent/consent.service.js";
import { activate, getRun } from "./activation.service.js";

async function newOcc(): Promise<string> {
  const r = await pool.query<{ occ_id: string }>(
    "INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id",
  );
  return r.rows[0]!.occ_id;
}

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("activation — consent gate (deny-by-default)", () => {
  it("chỉ kích hoạt người ĐÃ granted; người chưa consent bị suppress", async () => {
    const granted = await newOcc();
    const noConsent = await newOcc();
    const withdrawn = await newOcc();
    await recordConsent(pool, {
      occId: granted,
      purpose: "marketing_email",
      status: "granted",
      source: "web",
    });
    await recordConsent(pool, {
      occId: withdrawn,
      purpose: "marketing_email",
      status: "granted",
      source: "web",
    });
    await recordConsent(pool, {
      occId: withdrawn,
      purpose: "marketing_email",
      status: "withdrawn",
      source: "csr",
    });

    const res = await activate(pool, {
      audienceName: "Khách thân thiết",
      purpose: "marketing_email",
      channel: "email",
      destination: "rudderstack",
      occIds: [granted, noConsent, withdrawn],
    });

    expect(res.total).toBe(3);
    expect(res.allowedCount).toBe(1);
    expect(res.suppressedCount).toBe(2);
    expect(res.allowed).toEqual([granted]);
  });

  it("ghi activation_run + activation_member với decision", async () => {
    const a = await newOcc();
    await recordConsent(pool, { occId: a, purpose: "marketing_sms", status: "granted", source: "web" });
    const b = await newOcc();

    const res = await activate(pool, {
      audienceName: "SMS test",
      purpose: "marketing_sms",
      channel: "sms",
      destination: "rudderstack",
      occIds: [a, b],
    });

    const run = await getRun(pool, res.runId);
    expect(run).not.toBeNull();
    expect(run!.allowed_count).toBe(1);
    expect(run!.suppressed_count).toBe(1);

    const members = await pool.query<{ occ_id: string; decision: string }>(
      "SELECT occ_id, decision FROM cdp.activation_member WHERE run_id=$1 ORDER BY decision",
      [res.runId],
    );
    const byOcc = Object.fromEntries(members.rows.map((m) => [m.occ_id, m.decision]));
    expect(byOcc[a]).toBe("allowed");
    expect(byOcc[b]).toBe("suppressed_no_consent");
  });

  it("danh sách rỗng -> run 0/0", async () => {
    const res = await activate(pool, {
      audienceName: "rỗng",
      purpose: "personalization",
      channel: "web",
      destination: "rudderstack",
      occIds: [],
    });
    expect(res.total).toBe(0);
    expect(res.allowedCount).toBe(0);
    expect(res.suppressedCount).toBe(0);
  });
});
