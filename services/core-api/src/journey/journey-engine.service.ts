import type { Pool, PoolClient } from "pg";
import { previewSegment } from "../segment/segment.service.js";
import { activate } from "../activation/activation.service.js";
import { earn } from "../loyalty/loyalty.service.js";
import {
  type JourneyDefinition,
  type JourneyNode,
  type ConditionPredicate,
  type ActionConfig,
  type EntryConfig,
  type WaitConfig,
  type ConditionConfig,
  JourneyValidationError,
  JourneyActionError,
} from "./journey.types.js";

// ── Engine journey: máy trạng thái BỀN VỮNG trong Postgres + tick worker ──
//
//   enroll ─► participant(active, current_node=firstNode, next_run_at=now)
//   tick   ─► claim due (FOR UPDATE SKIP LOCKED) ─► advance() 1 node/lần (transaction riêng)
//     wait      → next_run_at += delay, current_node = next   (delay TRƯỚC node kế)
//     condition → eval predicate → current_node = edge(yes|no)
//     action    → earn/activate (idempotencyKey journey:{pid}:{node}) → step_run(done) → next
//     exit/hết  → completed
//   Lỗi action: transient → retry (attempts<3, backoff); permanent/hết retry → failed.
//   Effectively-once: step_run UNIQUE(participant,node) + action idempotencyKey.

const MAX_ATTEMPTS = 3;

// ── Graph helpers ──
function entryNode(def: JourneyDefinition): JourneyNode | undefined {
  return def.nodes.find((n) => n.type === "entry");
}
function findNode(def: JourneyDefinition, id: string | null): JourneyNode | undefined {
  if (id === null) return undefined;
  return def.nodes.find((n) => n.id === id);
}
function nextNodeId(def: JourneyDefinition, fromId: string, branch?: "yes" | "no"): string | null {
  const edge = def.edges.find((e) => e.from === fromId && (branch ? e.branch === branch : true));
  return edge?.to ?? null;
}

/** Validate graph khi publish. Ném JourneyValidationError nếu sai. */
export function validateDefinition(def: JourneyDefinition): void {
  const entries = def.nodes.filter((n) => n.type === "entry");
  if (entries.length !== 1) throw new JourneyValidationError("Journey phải có đúng 1 node entry.");
  if (!def.nodes.some((n) => n.type === "exit")) throw new JourneyValidationError("Journey phải có ít nhất 1 node exit.");

  const ids = new Set(def.nodes.map((n) => n.id));
  for (const e of def.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new JourneyValidationError(`Cạnh trỏ tới node không tồn tại: ${e.from}→${e.to}.`);
  }
  for (const n of def.nodes) {
    const outs = def.edges.filter((e) => e.from === n.id);
    if (n.type === "exit") {
      if (outs.length > 0) throw new JourneyValidationError(`Node exit ${n.id} không được có cạnh ra.`);
      continue;
    }
    if (n.type === "condition") {
      const yes = outs.filter((e) => e.branch === "yes");
      const no = outs.filter((e) => e.branch === "no");
      if (yes.length !== 1 || no.length !== 1 || outs.length !== 2) {
        throw new JourneyValidationError(`Node condition ${n.id} phải có đúng 2 nhánh yes/no (không thừa/thiếu).`);
      }
      assertConditionConfig(n.id, n.config as ConditionConfig | undefined);
    } else if (outs.length !== 1) {
      throw new JourneyValidationError(`Node ${n.id} (${n.type}) phải có đúng 1 cạnh ra.`);
    }
    if (n.type === "action") assertActionConfig(n.id, n.config as ActionConfig | undefined);
    if (n.type === "wait") {
      const w = n.config as WaitConfig | undefined;
      if (!w || !Number.isFinite(w.delayMinutes) || w.delayMinutes <= 0) throw new JourneyValidationError(`Node wait ${n.id} cần delayMinutes > 0.`);
    }
    if (n.type === "entry") {
      const c = n.config as EntryConfig | undefined;
      if (!c || !["event", "segment", "manual"].includes(c.trigger)) throw new JourneyValidationError(`Node entry ${n.id} cần trigger hợp lệ.`);
    }
  }
  // v1: cấm mọi cycle (DAG). Wait là node delay trong DAG, không cần vòng lặp.
  assertAcyclic(def);
}

const PREDICATE_KINDS = new Set(["lifecycle", "churnRiskGte", "propensityGte", "loyaltyMinGte", "favoriteCategory", "consentGranted"]);
function assertConditionConfig(nodeId: string, cfg: ConditionConfig | undefined): void {
  const p = cfg?.predicate as ConditionPredicate | undefined;
  if (!p || typeof p !== "object" || !PREDICATE_KINDS.has(p.kind)) {
    throw new JourneyValidationError(`Node condition ${nodeId}: predicate.kind không hợp lệ.`);
  }
  if ((p.kind === "lifecycle" || p.kind === "favoriteCategory") && typeof (p as { equals?: unknown }).equals !== "string") {
    throw new JourneyValidationError(`Node condition ${nodeId}: predicate cần 'equals' (chuỗi).`);
  }
  if ((p.kind === "churnRiskGte" || p.kind === "propensityGte" || p.kind === "loyaltyMinGte") && !Number.isFinite((p as { value?: unknown }).value as number)) {
    throw new JourneyValidationError(`Node condition ${nodeId}: predicate cần 'value' (số).`);
  }
  if (p.kind === "consentGranted" && typeof (p as { purpose?: unknown }).purpose !== "string") {
    throw new JourneyValidationError(`Node condition ${nodeId}: predicate cần 'purpose' (chuỗi).`);
  }
}

function assertActionConfig(nodeId: string, cfg: ActionConfig | undefined): void {
  if (!cfg) throw new JourneyValidationError(`Node action ${nodeId} thiếu config.`);
  if (cfg.kind === "loyalty_bonus") {
    if (!Number.isInteger(cfg.points) || cfg.points <= 0) throw new JourneyValidationError(`Node action ${nodeId}: points phải nguyên dương.`);
  } else if (cfg.kind === "activation") {
    if (!cfg.purpose || !cfg.channel || !cfg.destination) throw new JourneyValidationError(`Node action ${nodeId}: activation thiếu purpose/channel/destination.`);
  } else {
    throw new JourneyValidationError(`Node action ${nodeId}: kind không hợp lệ.`);
  }
}

function assertAcyclic(def: JourneyDefinition): void {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(def.nodes.map((n) => [n.id, WHITE]));
  const adj = new Map<string, string[]>();
  for (const n of def.nodes) adj.set(n.id, []);
  for (const e of def.edges) adj.get(e.from)?.push(e.to);
  const dfs = (u: string): void => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const cv = color.get(v);
      if (cv === GRAY) throw new JourneyValidationError("Journey không được có vòng lặp (cycle).");
      if (cv === WHITE) dfs(v);
    }
    color.set(u, BLACK);
  };
  for (const n of def.nodes) if (color.get(n.id) === WHITE) dfs(n.id);
}

// ── Enroll ──
interface JourneyRow {
  journey_id: string;
  status: string;
  published_version: number | null;
}

async function loadActiveDefinition(pool: Pool, journeyId: string): Promise<{ version: number; def: JourneyDefinition } | null> {
  const jr = await pool.query<JourneyRow>(
    "SELECT journey_id, status, published_version FROM cdp.journey WHERE journey_id=$1",
    [journeyId],
  );
  const j = jr.rows[0];
  if (!j || j.status !== "active" || j.published_version === null) return null;
  const vr = await pool.query<{ definition: JourneyDefinition }>(
    "SELECT definition FROM cdp.journey_version WHERE journey_id=$1 AND version=$2",
    [journeyId, j.published_version],
  );
  const v = vr.rows[0];
  if (!v) return null;
  return { version: j.published_version, def: v.definition };
}

export interface EnrollResult {
  enrolled: boolean;
  participantId: string | null;
}

/** Đưa 1 occ_id vào journey (once-ever qua UNIQUE(journey,occ)). */
export async function enroll(pool: Pool, journeyId: string, occId: string): Promise<EnrollResult> {
  const active = await loadActiveDefinition(pool, journeyId);
  if (!active) return { enrolled: false, participantId: null };
  const entry = entryNode(active.def);
  if (!entry) return { enrolled: false, participantId: null };
  const firstNode = nextNodeId(active.def, entry.id);
  const r = await pool.query<{ id: string }>(
    `INSERT INTO cdp.journey_participant (journey_id, version, occ_id, current_node_id, next_run_at)
     VALUES ($1,$2,$3,$4, now())
     ON CONFLICT (journey_id, occ_id) DO NOTHING
     RETURNING id`,
    [journeyId, active.version, occId, firstNode],
  );
  const row = r.rows[0];
  return { enrolled: !!row, participantId: row?.id ?? null };
}

/** Enroll theo segment (trigger_config.segment hoặc entry segment). Trả số enroll mới. */
export async function enrollSegment(pool: Pool, journeyId: string): Promise<number> {
  const active = await loadActiveDefinition(pool, journeyId);
  if (!active) return 0;
  const entry = entryNode(active.def);
  const cfg = entry?.config as EntryConfig | undefined;
  if (!cfg?.segment) return 0;
  const seg = await previewSegment(pool, cfg.segment);
  let n = 0;
  for (const occId of seg.occIds) {
    const res = await enroll(pool, journeyId, occId);
    if (res.enrolled) n++;
  }
  return n;
}

// ── Tick ──
interface ParticipantRow {
  id: string;
  journey_id: string;
  version: number;
  occ_id: string;
  status: string;
  current_node_id: string | null;
  attempts: number;
}

export interface TickResult {
  processed: number;
}

/** Chạy 1 lượt: xử lý participant đến hạn, mỗi participant/1 node trong transaction riêng. */
export async function tick(pool: Pool, opts: { limit?: number } = {}): Promise<TickResult> {
  const limit = opts.limit ?? 50;
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const claim = await client.query<ParticipantRow>(
        `SELECT id, journey_id, version, occ_id, status, current_node_id, attempts
           FROM cdp.journey_participant
          WHERE status='active' AND next_run_at <= now()
          ORDER BY next_run_at
          LIMIT 1 FOR UPDATE SKIP LOCKED`,
      );
      const p = claim.rows[0];
      if (!p) {
        await client.query("ROLLBACK");
        break; // finally sẽ release client
      }
      await advanceParticipant(pool, client, p);
      await client.query("COMMIT");
      processed++;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  return { processed };
}

/** Load definition snapshot theo participant.version. Dùng CHÍNH client đang giữ lock
 *  (SELECT trong cùng tx) — tránh mở thêm connection khi đang giữ row lock. */
async function participantDefinition(client: PoolClient, p: ParticipantRow): Promise<JourneyDefinition | null> {
  const r = await client.query<{ definition: JourneyDefinition }>(
    "SELECT definition FROM cdp.journey_version WHERE journey_id=$1 AND version=$2",
    [p.journey_id, p.version],
  );
  return r.rows[0]?.definition ?? null;
}

async function complete(client: PoolClient, id: string, status: "completed" | "exited", reason?: string): Promise<void> {
  await client.query(
    "UPDATE cdp.journey_participant SET status=$2, completed_at=now(), exit_reason=$3, next_run_at=now() WHERE id=$1",
    [id, status, reason ?? null],
  );
}

async function fail(client: PoolClient, p: ParticipantRow, nodeId: string, nodeType: string, reason: string): Promise<void> {
  await client.query(
    `INSERT INTO cdp.journey_step_run (participant_id, node_id, node_type, status, result)
     VALUES ($1,$2,$3,'failed',$4) ON CONFLICT (participant_id, node_id) DO NOTHING`,
    [p.id, nodeId, nodeType, JSON.stringify({ reason })],
  );
  await client.query(
    "UPDATE cdp.journey_participant SET status='failed', exit_reason=$2, completed_at=now() WHERE id=$1",
    [p.id, reason],
  );
}

/** Thực thi 1 node cho participant (đang giữ row lock trong client transaction).
 *  Mọi READ dùng client (cùng tx). Side-effect action (earn/activate) dùng pool riêng
 *  (commit độc lập, idempotent). Mọi lỗi node → handleActionError (retry/fail) — KHÔNG
 *  để throw thoát khỏi tick (một participant hỏng không làm sập cả lượt). */
async function advanceParticipant(pool: Pool, client: PoolClient, p: ParticipantRow): Promise<void> {
  const def = await participantDefinition(client, p);
  if (!def) {
    await complete(client, p.id, "exited", "definition-missing");
    return;
  }
  const node = findNode(def, p.current_node_id);
  if (!node) {
    await complete(client, p.id, "completed");
    return;
  }
  if (node.type === "exit") {
    // Ghi step_run exit → funnel đếm đúng per-exit (multi-exit) & không phụ thuộc version.
    await recordStep(client, p, node, {});
    await complete(client, p.id, "completed");
    return;
  }

  try {
    if (node.type === "wait") {
      const w = node.config as WaitConfig;
      const next = nextNodeId(def, node.id);
      await recordStep(client, p, node, { waited: w.delayMinutes });
      await client.query(
        "UPDATE cdp.journey_participant SET current_node_id=$2, next_run_at = now() + make_interval(mins => $3), attempts=0 WHERE id=$1",
        [p.id, next, w.delayMinutes],
      );
    } else if (node.type === "condition") {
      const cfg = node.config as ConditionConfig;
      const branch = (await evalPredicate(client, p.occ_id, cfg.predicate)) ? "yes" : "no";
      await recordStep(client, p, node, { branch });
      await moveTo(client, p.id, nextNodeId(def, node.id, branch));
    } else if (node.type === "action") {
      const result = await runAction(pool, p, node);
      await recordStep(client, p, node, result);
      await moveTo(client, p.id, nextNodeId(def, node.id));
    } else {
      // entry hoặc type lạ → nhảy tới node kế.
      await moveTo(client, p.id, nextNodeId(def, node.id));
    }
  } catch (err) {
    await handleActionError(client, p, node, err);
  }
}

async function moveTo(client: PoolClient, id: string, next: string | null): Promise<void> {
  await client.query(
    "UPDATE cdp.journey_participant SET current_node_id=$2, next_run_at=now(), attempts=0 WHERE id=$1",
    [id, next],
  );
}

async function recordStep(client: PoolClient, p: ParticipantRow, node: JourneyNode, result: Record<string, unknown>): Promise<void> {
  await client.query(
    `INSERT INTO cdp.journey_step_run (participant_id, node_id, node_type, status, result)
     VALUES ($1,$2,$3,'done',$4) ON CONFLICT (participant_id, node_id) DO NOTHING`,
    [p.id, node.id, node.type, JSON.stringify(result)],
  );
}

async function handleActionError(client: PoolClient, p: ParticipantRow, node: JourneyNode, err: unknown): Promise<void> {
  const transient = err instanceof JourneyActionError ? err.transient : true; // mặc định coi là transient để retry
  const message = err instanceof Error ? err.message : "action error";
  if (transient && p.attempts + 1 < MAX_ATTEMPTS) {
    // backoff: 2^attempts phút.
    const backoff = Math.pow(2, p.attempts);
    await client.query(
      "UPDATE cdp.journey_participant SET attempts=attempts+1, next_run_at = now() + make_interval(mins => $2) WHERE id=$1",
      [p.id, backoff],
    );
  } else {
    await fail(client, p, node.id, node.type, `${transient ? "transient-exhausted" : "permanent"}: ${message}`);
  }
}

/** Thực thi action (side-effect qua pool riêng, idempotent theo key journey:{pid}:{node}). */
async function runAction(pool: Pool, p: ParticipantRow, node: JourneyNode): Promise<Record<string, unknown>> {
  const cfg = node.config as ActionConfig;
  const key = `journey:${p.id}:${node.id}`;
  if (cfg.kind === "loyalty_bonus") {
    const r = await earn(pool, { occId: p.occ_id, points: cfg.points, idempotencyKey: key, reason: `journey:${node.id}` });
    return { kind: "loyalty_bonus", points: cfg.points, txnId: r.txnId };
  }
  // activation: gate consent bên trong activate(); idempotent qua key.
  const r = await activate(pool, {
    audienceName: `journey:${node.id}`,
    purpose: cfg.purpose,
    channel: cfg.channel,
    destination: cfg.destination,
    occIds: [p.occ_id],
    idempotencyKey: key,
  });
  return { kind: "activation", activationRunId: r.runId, allowedCount: r.allowedCount, suppressedCount: r.suppressedCount };
}

/** Đánh giá predicate condition trên customer_feature / consent — dùng client (cùng tx). */
async function evalPredicate(client: PoolClient, occId: string, pred: ConditionPredicate): Promise<boolean> {
  if (pred.kind === "consentGranted") {
    // Latest-wins, deny-by-default (vắng mặt = false). Cùng logic consent.service.
    const c = await client.query<{ status: string }>(
      `SELECT status FROM (
         SELECT DISTINCT ON (purpose) status FROM cdp.consent_record
         WHERE occ_id=$1 AND purpose=$2 ORDER BY purpose, recorded_at DESC, id DESC
       ) s`,
      [occId, pred.purpose],
    );
    return c.rows[0]?.status === "granted";
  }
  const r = await client.query<{
    lifecycle_stage: string | null;
    churn_risk: number | null;
    propensity_score: number | null;
    loyalty_available: number | null;
    favorite_category: string | null;
  }>(
    `SELECT lifecycle_stage, churn_risk, propensity_score, loyalty_available, favorite_category
       FROM cdp.customer_feature WHERE occ_id=$1`,
    [occId],
  );
  const f = r.rows[0];
  if (!f) return false;
  switch (pred.kind) {
    case "lifecycle":
      return f.lifecycle_stage === pred.equals;
    case "churnRiskGte":
      return f.churn_risk !== null && f.churn_risk >= pred.value;
    case "propensityGte":
      return f.propensity_score !== null && f.propensity_score >= pred.value;
    case "loyaltyMinGte":
      return f.loyalty_available !== null && f.loyalty_available >= pred.value;
    case "favoriteCategory":
      return f.favorite_category === pred.equals;
    default:
      return false;
  }
}
