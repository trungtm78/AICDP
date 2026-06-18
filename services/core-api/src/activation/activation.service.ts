import type { Pool, PoolClient } from "pg";
import { isAllowed } from "../consent/consent.service.js";

// Activation: gửi audience tới destination, GATE bằng consent (deny-by-default).
// Người chưa granted purpose tương ứng bị suppress (không gửi). Ghi run + member để audit.

export interface ActivateArgs {
  audienceName: string;
  purpose: string;
  channel: string;
  destination: string;
  occIds: string[];
}

export interface ActivateResult {
  runId: string;
  total: number;
  allowedCount: number;
  suppressedCount: number;
  allowed: string[];
}

export interface ActivationRun {
  run_id: string;
  audience_name: string;
  purpose: string;
  channel: string;
  destination: string;
  total: number;
  allowed_count: number;
  suppressed_count: number;
  created_at: string;
}

export async function activate(pool: Pool, a: ActivateArgs): Promise<ActivateResult> {
  // Quyết định gate consent cho từng người (chokepoint deny-by-default).
  const decisions = await Promise.all(
    a.occIds.map(async (occId) => ({
      occId,
      allowed: await isAllowed(pool, occId, a.purpose),
    })),
  );
  const allowed = decisions.filter((d) => d.allowed).map((d) => d.occId);
  const suppressed = decisions.filter((d) => !d.allowed).map((d) => d.occId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const run = await client.query<{ run_id: string }>(
      `INSERT INTO cdp.activation_run
         (audience_name, purpose, channel, destination, total, allowed_count, suppressed_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING run_id`,
      [
        a.audienceName,
        a.purpose,
        a.channel,
        a.destination,
        a.occIds.length,
        allowed.length,
        suppressed.length,
      ],
    );
    const runId = run.rows[0]!.run_id;
    await insertMembers(client, runId, allowed, "allowed");
    await insertMembers(client, runId, suppressed, "suppressed_no_consent");
    await client.query("COMMIT");
    return {
      runId,
      total: a.occIds.length,
      allowedCount: allowed.length,
      suppressedCount: suppressed.length,
      allowed,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function insertMembers(
  client: PoolClient,
  runId: string,
  occIds: string[],
  decision: "allowed" | "suppressed_no_consent",
): Promise<void> {
  for (const occId of occIds) {
    await client.query(
      "INSERT INTO cdp.activation_member (run_id, occ_id, decision) VALUES ($1,$2,$3)",
      [runId, occId, decision],
    );
  }
}

export async function getRun(pool: Pool, runId: string): Promise<ActivationRun | null> {
  const r = await pool.query<ActivationRun>(
    `SELECT run_id, audience_name, purpose, channel, destination,
            total, allowed_count, suppressed_count, created_at
       FROM cdp.activation_run WHERE run_id=$1`,
    [runId],
  );
  return r.rows[0] ?? null;
}
