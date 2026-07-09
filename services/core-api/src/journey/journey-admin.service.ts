import type { Pool } from "pg";
import { validateDefinition } from "./journey-engine.service.js";
import { type JourneyDefinition, JourneyValidationError } from "./journey.types.js";

// Quản trị journey: soạn draft → publish (snapshot version) → activate (bật enroll) → pause/archive.
// Publish TÁCH activate: soạn/validate không lỡ tay chạy.

export interface JourneyRow {
  journey_id: string;
  name: string;
  status: string;
  trigger_type: string | null;
  trigger_config: Record<string, unknown>;
  definition: JourneyDefinition | null;
  published_version: number | null;
  allow_re_enroll: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

const COLS = `journey_id, name, status, trigger_type, trigger_config, definition,
              published_version, allow_re_enroll, created_at, updated_at, published_at`;

export interface CreateDraftArgs {
  name: string;
  triggerType?: "event" | "segment" | "manual";
  triggerConfig?: Record<string, unknown>;
  definition?: JourneyDefinition;
}

export async function createDraft(pool: Pool, a: CreateDraftArgs): Promise<JourneyRow> {
  const r = await pool.query<JourneyRow>(
    `INSERT INTO cdp.journey (name, status, trigger_type, trigger_config, definition, action)
     VALUES ($1,'draft',$2,$3,$4,'{}')
     RETURNING ${COLS}`,
    [a.name, a.triggerType ?? null, JSON.stringify(a.triggerConfig ?? {}), a.definition ? JSON.stringify(a.definition) : null],
  );
  return r.rows[0]!;
}

export interface SaveArgs {
  name?: string;
  triggerType?: "event" | "segment" | "manual";
  triggerConfig?: Record<string, unknown>;
  definition?: JourneyDefinition;
}

/** Lưu draft (chỉ khi status='draft'|'paused'). */
export async function saveDraft(pool: Pool, journeyId: string, a: SaveArgs): Promise<JourneyRow | null> {
  const r = await pool.query<JourneyRow>(
    `UPDATE cdp.journey SET
        name = COALESCE($2, name),
        trigger_type = COALESCE($3, trigger_type),
        trigger_config = COALESCE($4, trigger_config),
        definition = COALESCE($5, definition),
        updated_at = now()
     WHERE journey_id=$1 AND status IN ('draft','paused')
     RETURNING ${COLS}`,
    [
      journeyId,
      a.name ?? null,
      a.triggerType ?? null,
      a.triggerConfig ? JSON.stringify(a.triggerConfig) : null,
      a.definition ? JSON.stringify(a.definition) : null,
    ],
  );
  return r.rows[0] ?? null;
}

export async function getJourney(pool: Pool, journeyId: string): Promise<JourneyRow | null> {
  const r = await pool.query<JourneyRow>(`SELECT ${COLS} FROM cdp.journey WHERE journey_id=$1`, [journeyId]);
  return r.rows[0] ?? null;
}

export interface JourneySummary extends JourneyRow {
  participants: number;
  completed: number;
}

export async function listJourneys(pool: Pool): Promise<JourneySummary[]> {
  const r = await pool.query<JourneySummary>(
    `SELECT ${COLS.split(",").map((c) => "j." + c.trim()).join(", ")},
            COALESCE(p.total,0)::int AS participants,
            COALESCE(p.completed,0)::int AS completed
       FROM cdp.journey j
       LEFT JOIN (
         SELECT journey_id, count(*) AS total,
                count(*) FILTER (WHERE status='completed') AS completed
           FROM cdp.journey_participant GROUP BY journey_id
       ) p ON p.journey_id = j.journey_id
      WHERE j.status <> 'archived'
      ORDER BY j.updated_at DESC`,
  );
  return r.rows;
}

/** Publish: khóa row → RE-READ definition (chống TOCTOU) → validate → snapshot version.
 *  KHÔNG bật enroll. Đọc+validate TRONG lock để saveDraft đồng thời không chèn version cũ. */
export async function publish(pool: Pool, journeyId: string, publishedBy: string | null): Promise<{ version: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ published_version: number | null; definition: JourneyDefinition | null }>(
      "SELECT published_version, definition FROM cdp.journey WHERE journey_id=$1 FOR UPDATE",
      [journeyId],
    );
    const row = cur.rows[0];
    if (!row) throw new JourneyValidationError("Journey không tồn tại.");
    if (!row.definition) throw new JourneyValidationError("Journey chưa có definition để publish.");
    validateDefinition(row.definition); // re-read trong lock → luôn khớp draft hiện tại
    const version = (row.published_version ?? 0) + 1;
    await client.query(
      "INSERT INTO cdp.journey_version (journey_id, version, definition, published_by) VALUES ($1,$2,$3,$4)",
      [journeyId, version, JSON.stringify(row.definition), publishedBy],
    );
    await client.query(
      "UPDATE cdp.journey SET published_version=$2, published_at=now(), updated_at=now() WHERE journey_id=$1",
      [journeyId, version],
    );
    await client.query("COMMIT");
    return { version };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Bật enroll (chỉ khi đã publish). */
export async function activateJourney(pool: Pool, journeyId: string): Promise<JourneyRow | null> {
  const r = await pool.query<JourneyRow>(
    `UPDATE cdp.journey SET status='active', updated_at=now()
      WHERE journey_id=$1 AND published_version IS NOT NULL AND status IN ('draft','paused')
      RETURNING ${COLS}`,
    [journeyId],
  );
  return r.rows[0] ?? null;
}

export async function setStatus(pool: Pool, journeyId: string, status: "paused" | "archived"): Promise<JourneyRow | null> {
  const r = await pool.query<JourneyRow>(
    `UPDATE cdp.journey SET status=$2, updated_at=now() WHERE journey_id=$1 RETURNING ${COLS}`,
    [journeyId, status],
  );
  return r.rows[0] ?? null;
}

// ── Participants ──
export interface ParticipantView {
  id: string;
  occ_id: string;
  status: string;
  current_node_id: string | null;
  attempts: number;
  enrolled_at: string;
  completed_at: string | null;
  exit_reason: string | null;
}

export async function listParticipants(
  pool: Pool,
  journeyId: string,
  opts: { status?: string; limit?: number; offset?: number } = {},
): Promise<{ rows: ParticipantView[]; total: number }> {
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const params: unknown[] = [journeyId];
  let where = "journey_id=$1";
  if (opts.status) {
    params.push(opts.status);
    where += ` AND status=$${params.length}`;
  }
  const totalR = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM cdp.journey_participant WHERE ${where}`, params);
  params.push(limit, offset);
  const r = await pool.query<ParticipantView>(
    `SELECT id, occ_id, status, current_node_id, attempts, enrolled_at, completed_at, exit_reason
       FROM cdp.journey_participant WHERE ${where}
      ORDER BY enrolled_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows: r.rows, total: Number(totalR.rows[0]!.n) };
}

/** Retry participant failed → active (reset attempts). */
export async function retryParticipant(pool: Pool, participantId: string): Promise<boolean> {
  const r = await pool.query(
    "UPDATE cdp.journey_participant SET status='active', attempts=0, next_run_at=now(), exit_reason=null, completed_at=null WHERE id=$1 AND status='failed'",
    [participantId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function forceExitParticipant(pool: Pool, participantId: string): Promise<boolean> {
  const r = await pool.query(
    "UPDATE cdp.journey_participant SET status='exited', exit_reason='force-exit', completed_at=now() WHERE id=$1 AND status IN ('active','failed')",
    [participantId],
  );
  return (r.rowCount ?? 0) > 0;
}
