import type { Pool } from "pg";
import {
  CATALOG_CONNECTORS,
  CATALOG_TEMPLATES,
  connectorByKey,
  templateByKey,
  type CatalogConnector,
} from "./catalog.js";
import { encryptConfig, decryptConfig, maskConfig } from "./secrets.js";
import { AppError } from "../http/errors.js";

/** Bảo đảm connectorKey tồn tại (catalog ∪ custom) + đúng direction. Chống: key sai -> secret field
 *  không được nhận diện -> lưu plaintext + trả nguyên ra API (rò secret). */
async function assertConnectorExists(
  pool: Pool,
  connectorKey: string,
  direction: "source" | "destination",
): Promise<void> {
  const bad = (msg: string): AppError =>
    new AppError({ code: "NOT_FOUND", httpStatus: 400, message: msg,
      why: "Connector không có trong catalog hoặc bảng connector tuỳ biến.",
      fix: "Dùng connectorKey hợp lệ và đúng chiều (source/destination).", retryable: false });
  const cat = connectorByKey(connectorKey);
  if (cat) {
    if (cat.direction !== direction) throw bad(`Connector '${connectorKey}' là ${cat.direction}, không phải ${direction}.`);
    return;
  }
  const r = await pool.query<{ direction: string }>("SELECT direction FROM cdp.connector WHERE key=$1", [connectorKey]);
  const row = r.rows[0];
  if (!row) throw bad(`Connector không tồn tại: ${connectorKey}.`);
  if (row.direction !== direction) throw bad(`Connector '${connectorKey}' là ${row.direction}, không phải ${direction}.`);
}

// Connector & Pipeline builder (demo-grade): lưu connection/pipeline + connector tuỳ biến.
// Không nối RudderStack live — trạng thái mô phỏng; đây là lớp cấu hình cho giai đoạn tích hợp.

export class PipelineValidationError extends Error {
  readonly code = "PIPELINE_INVALID";
  constructor(message: string) {
    super(message);
    this.name = "PipelineValidationError";
  }
}

// ── Catalog (tĩnh ∪ custom) ──
export interface ConnectorRow extends CatalogConnector {}

export async function getCatalog(pool: Pool): Promise<{ connectors: ConnectorRow[]; templates: typeof CATALOG_TEMPLATES }> {
  const custom = await listCustomConnectors(pool);
  return { connectors: [...CATALOG_CONNECTORS, ...custom], templates: CATALOG_TEMPLATES };
}

export interface CustomConnectorInput {
  key: string;
  name: string;
  direction: "source" | "destination";
  category: string;
  transport: "rest" | "webhook" | "database" | "sdk" | "warehouse";
  configSchema?: unknown[] | undefined;
  blurb?: string | undefined;
}

export async function listCustomConnectors(pool: Pool): Promise<ConnectorRow[]> {
  const r = await pool.query<{
    key: string; name: string; direction: "source" | "destination"; category: string;
    transport: ConnectorRow["transport"]; config_schema: unknown; blurb: string | null;
  }>(`SELECT key, name, direction, category, transport, config_schema, blurb FROM cdp.connector ORDER BY created_at DESC`);
  return r.rows.map((c) => ({
    key: c.key, name: c.name, direction: c.direction, category: c.category, transport: c.transport,
    configFields: (Array.isArray(c.config_schema) ? c.config_schema : []) as CatalogConnector["configFields"],
    blurb: c.blurb ?? "", isCustom: true,
  }));
}

export async function createConnector(pool: Pool, a: CustomConnectorInput): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.connector (key, name, direction, category, transport, config_schema, blurb, is_custom)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,true)
     ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, direction=EXCLUDED.direction,
       category=EXCLUDED.category, transport=EXCLUDED.transport, config_schema=EXCLUDED.config_schema, blurb=EXCLUDED.blurb`,
    [a.key, a.name, a.direction, a.category, a.transport, JSON.stringify(a.configSchema ?? []), a.blurb ?? null],
  );
}

export async function deleteConnector(pool: Pool, key: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM cdp.connector WHERE key=$1", [key]);
  return (r.rowCount ?? 0) > 0;
}

// ── Connections ──
export interface Connection {
  id: string;
  name: string;
  direction: "source" | "destination";
  connectorKey: string;
  connectorName: string;
  config: Record<string, unknown>;
  status: "active" | "paused" | "draft" | "error";
  createdAt: string;
}

interface ConnectionRow {
  id: string; name: string; direction: "source" | "destination"; connector_key: string;
  config: Record<string, unknown>; status: Connection["status"]; created_at: string;
}
// config trả ra API LUÔN mask secret (không bao giờ lộ plaintext/ciphertext ra client).
const mapConnection = (r: ConnectionRow): Connection => ({
  id: r.id, name: r.name, direction: r.direction, connectorKey: r.connector_key,
  connectorName: connectorByKey(r.connector_key)?.name ?? r.connector_key,
  config: maskConfig(r.config ?? {}), status: r.status, createdAt: r.created_at,
});

/** Field secret của connector (từ catalog tĩnh; nếu là custom -> đọc config_schema). */
export async function secretFieldsFor(pool: Pool, connectorKey: string): Promise<string[]> {
  const cat = connectorByKey(connectorKey);
  if (cat) return cat.configFields.filter((f) => f.secret).map((f) => f.key);
  const r = await pool.query<{ config_schema: unknown }>(
    "SELECT config_schema FROM cdp.connector WHERE key=$1", [connectorKey],
  );
  const schema = r.rows[0]?.config_schema;
  if (!Array.isArray(schema)) return [];
  return (schema as Array<{ key?: string; secret?: boolean }>)
    .filter((f) => f.secret && typeof f.key === "string")
    .map((f) => f.key as string);
}

/** Đọc config ĐÃ GIẢI MÃ của 1 connection (CHỈ dùng nội bộ: giao hàng/health/pull — KHÔNG trả client). */
export async function getConnectionConfigDecrypted(
  pool: Pool,
  id: string,
): Promise<{ connectorKey: string; config: Record<string, unknown> } | null> {
  const r = await pool.query<{ connector_key: string; config: Record<string, unknown> }>(
    "SELECT connector_key, config FROM cdp.connection WHERE id=$1", [id],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { connectorKey: row.connector_key, config: decryptConfig(row.config ?? {}) };
}

export async function listConnections(pool: Pool): Promise<Connection[]> {
  const r = await pool.query<ConnectionRow>(
    `SELECT id, name, direction, connector_key, config, status, created_at
       FROM cdp.connection ORDER BY created_at DESC`,
  );
  return r.rows.map(mapConnection);
}

export async function createConnection(
  pool: Pool,
  a: { name: string; direction: "source" | "destination"; connectorKey: string; config?: Record<string, unknown> | undefined; status?: Connection["status"] | undefined },
): Promise<Connection> {
  // Validate connectorKey tồn tại + đúng direction (chống rò secret do key sai).
  await assertConnectorExists(pool, a.connectorKey, a.direction);
  // Mã hoá field secret TRƯỚC khi lưu (AES-256-GCM) — không bao giờ lưu plaintext.
  const secretFields = await secretFieldsFor(pool, a.connectorKey);
  const storedConfig = encryptConfig(a.config ?? {}, secretFields);
  const r = await pool.query<ConnectionRow>(
    `INSERT INTO cdp.connection (name, direction, connector_key, config, status)
     VALUES ($1,$2,$3,$4::jsonb,$5)
     RETURNING id, name, direction, connector_key, config, status, created_at`,
    [a.name, a.direction, a.connectorKey, JSON.stringify(storedConfig), a.status ?? "active"],
  );
  return mapConnection(r.rows[0]!);
}

export async function setConnectionStatus(pool: Pool, id: string, status: Connection["status"]): Promise<boolean> {
  const r = await pool.query("UPDATE cdp.connection SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
  return (r.rowCount ?? 0) > 0;
}

export async function deleteConnection(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM cdp.connection WHERE id=$1", [id]);
  return (r.rowCount ?? 0) > 0;
}

// ── Pipelines (ETL kéo-thả) ──
export interface PipelineNode {
  id: string;
  type: "source" | "transform" | "destination";
  config?: Record<string, unknown> | undefined;
  pos?: { x: number; y: number } | undefined;
}
export interface PipelineEdge { from: string; to: string }
export interface PipelineDefinition { nodes: PipelineNode[]; edges: PipelineEdge[] }
export interface Pipeline {
  id: string;
  name: string;
  kind: "event_stream" | "etl" | "reverse_etl";
  definition: PipelineDefinition;
  status: "active" | "paused" | "draft";
  createdAt: string;
}

interface PipelineRow {
  id: string; name: string; kind: Pipeline["kind"]; definition: PipelineDefinition;
  status: Pipeline["status"]; created_at: string;
}
const mapPipeline = (r: PipelineRow): Pipeline => ({
  id: r.id, name: r.name, kind: r.kind, definition: r.definition, status: r.status, createdAt: r.created_at,
});

/** Validate pipeline: ≥1 source, ≥1 destination, cạnh trỏ node tồn tại. */
export function validatePipeline(def: PipelineDefinition): void {
  if (!def.nodes.some((n) => n.type === "source")) throw new PipelineValidationError("Pipeline cần ít nhất 1 Nguồn (Source).");
  if (!def.nodes.some((n) => n.type === "destination")) throw new PipelineValidationError("Pipeline cần ít nhất 1 Đích (Destination).");
  const ids = new Set(def.nodes.map((n) => n.id));
  for (const e of def.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) throw new PipelineValidationError(`Cạnh trỏ tới node không tồn tại: ${e.from}→${e.to}.`);
  }
}

export async function listPipelines(pool: Pool): Promise<Pipeline[]> {
  const r = await pool.query<PipelineRow>(
    `SELECT id, name, kind, definition, status, created_at FROM cdp.pipeline ORDER BY created_at DESC`,
  );
  return r.rows.map(mapPipeline);
}

export async function getPipeline(pool: Pool, id: string): Promise<Pipeline | null> {
  const r = await pool.query<PipelineRow>(
    `SELECT id, name, kind, definition, status, created_at FROM cdp.pipeline WHERE id=$1`,
    [id],
  );
  return r.rows[0] ? mapPipeline(r.rows[0]) : null;
}

export async function createPipeline(
  pool: Pool,
  a: { name: string; kind?: Pipeline["kind"] | undefined; definition?: PipelineDefinition | undefined; status?: Pipeline["status"] | undefined },
): Promise<Pipeline> {
  const def = a.definition ?? { nodes: [], edges: [] };
  const r = await pool.query<PipelineRow>(
    `INSERT INTO cdp.pipeline (name, kind, definition, status)
     VALUES ($1,$2,$3::jsonb,$4)
     RETURNING id, name, kind, definition, status, created_at`,
    [a.name, a.kind ?? "event_stream", JSON.stringify(def), a.status ?? "draft"],
  );
  return mapPipeline(r.rows[0]!);
}

export async function savePipeline(
  pool: Pool,
  id: string,
  a: { name?: string | undefined; kind?: Pipeline["kind"] | undefined; definition?: PipelineDefinition | undefined; status?: Pipeline["status"] | undefined },
): Promise<Pipeline | null> {
  if (a.definition) validatePipeline(a.definition);
  const sets: string[] = [];
  const params: unknown[] = [id];
  if (a.name !== undefined) { params.push(a.name); sets.push(`name=$${params.length}`); }
  if (a.kind !== undefined) { params.push(a.kind); sets.push(`kind=$${params.length}`); }
  if (a.definition !== undefined) { params.push(JSON.stringify(a.definition)); sets.push(`definition=$${params.length}::jsonb`); }
  if (a.status !== undefined) { params.push(a.status); sets.push(`status=$${params.length}`); }
  if (sets.length === 0) return getPipeline(pool, id);
  const r = await pool.query<PipelineRow>(
    `UPDATE cdp.pipeline SET ${sets.join(", ")}, updated_at=now() WHERE id=$1
     RETURNING id, name, kind, definition, status, created_at`,
    params,
  );
  return r.rows[0] ? mapPipeline(r.rows[0]) : null;
}

export async function setPipelineStatus(pool: Pool, id: string, status: Pipeline["status"]): Promise<boolean> {
  if (status === "active") {
    const p = await getPipeline(pool, id);
    if (p) validatePipeline(p.definition); // không cho kích hoạt pipeline sai
  }
  const r = await pool.query("UPDATE cdp.pipeline SET status=$2, updated_at=now() WHERE id=$1", [id, status]);
  return (r.rowCount ?? 0) > 0;
}

export async function deletePipeline(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query("DELETE FROM cdp.pipeline WHERE id=$1", [id]);
  return (r.rowCount ?? 0) > 0;
}

// ── Áp dụng mô hình dựng sẵn ──
export async function applyTemplate(pool: Pool, templateKey: string): Promise<{ kind: "connection" | "pipeline"; id: string }> {
  const t = templateByKey(templateKey);
  if (!t) throw new PipelineValidationError(`Mô hình không tồn tại: ${templateKey}`);

  if (t.kind === "connection") {
    const conn = connectorByKey(t.connectorKey!);
    const c = await createConnection(pool, {
      name: t.name,
      direction: t.direction!,
      connectorKey: t.connectorKey!,
      config: {},
      status: "active",
    });
    void conn;
    return { kind: "connection", id: c.id };
  }

  // pipeline template: source → (transform) → destination, có pos để canvas đẹp
  const nodes: PipelineNode[] = [
    { id: "s", type: "source", config: { connectorKey: t.sourceKey }, pos: { x: 60, y: 180 } },
    { id: "t", type: "transform", config: { kind: t.transform }, pos: { x: 340, y: 180 } },
    { id: "d", type: "destination", config: { connectorKey: t.destinationKey }, pos: { x: 620, y: 180 } },
  ];
  const edges: PipelineEdge[] = [{ from: "s", to: "t" }, { from: "t", to: "d" }];
  const p = await createPipeline(pool, { name: t.name, kind: t.pipelineKind ?? "event_stream", definition: { nodes, edges }, status: "active" });
  return { kind: "pipeline", id: p.id };
}
