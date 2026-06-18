import type { Pool } from "pg";
import { previewSegment, type SegmentCriteria } from "../segment/segment.service.js";
import { activate } from "../activation/activation.service.js";
import { earn } from "../loyalty/loyalty.service.js";

// Journeys: orchestration chaining segment -> action. Tái dùng segment/activation/loyalty.

export type JourneyAction =
  | { type: "activation"; purpose: string; channel: string; destination: string }
  | { type: "loyalty_bonus"; points: number };

export interface Journey {
  journey_id: string;
  name: string;
  segment_criteria: SegmentCriteria;
  action: JourneyAction;
  status: string;
  created_at: string;
}

export interface CreateJourneyArgs {
  name: string;
  segmentCriteria: SegmentCriteria;
  action: JourneyAction;
}

export interface JourneyRunResult {
  runId: string;
  total: number;
  actionResult: Record<string, unknown>;
}

export async function createJourney(pool: Pool, a: CreateJourneyArgs): Promise<Journey> {
  const r = await pool.query<Journey>(
    `INSERT INTO cdp.journey (name, segment_criteria, action)
     VALUES ($1,$2,$3)
     RETURNING journey_id, name, segment_criteria, action, status, created_at`,
    [a.name, JSON.stringify(a.segmentCriteria), JSON.stringify(a.action)],
  );
  return r.rows[0]!;
}

export async function listJourneys(pool: Pool): Promise<Journey[]> {
  const r = await pool.query<Journey>(
    `SELECT journey_id, name, segment_criteria, action, status, created_at
       FROM cdp.journey WHERE status='active' ORDER BY created_at DESC`,
  );
  return r.rows;
}

export async function getJourney(pool: Pool, journeyId: string): Promise<Journey | null> {
  const r = await pool.query<Journey>(
    `SELECT journey_id, name, segment_criteria, action, status, created_at
       FROM cdp.journey WHERE journey_id=$1`,
    [journeyId],
  );
  return r.rows[0] ?? null;
}

/** Chạy journey: resolve segment -> thực thi action -> ghi journey_run. */
export async function runJourney(pool: Pool, journeyId: string): Promise<JourneyRunResult> {
  const journey = await getJourney(pool, journeyId);
  if (!journey) throw new Error(`journey không tồn tại: ${journeyId}`);

  const seg = await previewSegment(pool, journey.segment_criteria);

  // Tạo run trước để có run_id ổn định (idempotency key cho loyalty bonus).
  const runIns = await pool.query<{ run_id: string }>(
    "INSERT INTO cdp.journey_run (journey_id, total, action_result) VALUES ($1,$2,'{}') RETURNING run_id",
    [journeyId, seg.count],
  );
  const runId = runIns.rows[0]!.run_id;

  let actionResult: Record<string, unknown>;
  const action = journey.action;
  if (action.type === "activation") {
    const res = await activate(pool, {
      audienceName: journey.name,
      purpose: action.purpose,
      channel: action.channel,
      destination: action.destination,
      occIds: seg.occIds,
    });
    actionResult = {
      kind: "activation",
      activationRunId: res.runId,
      allowedCount: res.allowedCount,
      suppressedCount: res.suppressedCount,
    };
  } else {
    let credited = 0;
    for (const occId of seg.occIds) {
      // idempotency theo run: chạy lại CÙNG run không cộng trùng.
      await earn(pool, {
        occId,
        points: action.points,
        idempotencyKey: `journey:${runId}:${occId}`,
        reason: `journey:${journey.name}`,
      });
      credited++;
    }
    actionResult = { kind: "loyalty_bonus", credited, points: action.points };
  }

  await pool.query("UPDATE cdp.journey_run SET action_result=$2 WHERE run_id=$1", [
    runId,
    JSON.stringify(actionResult),
  ]);

  return { runId, total: seg.count, actionResult };
}
