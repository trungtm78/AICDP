import type { Pool } from "pg";

// Ghi/đọc nhật ký INBOUND (connector_event) + OUTBOUND (connector_delivery). KHÔNG lưu payload/secret
// — chỉ metadata quan sát. Dùng bởi cổng webhook, activation delivery, test-send, data-summary.

export interface ConnectorEventInput {
  connectionId: string;
  eventType: string;
  messageId?: string | null;
  occId?: string | null;
  status: "ingested" | "rejected";
  error?: string | null;
}

export async function recordEvent(pool: Pool, e: ConnectorEventInput): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.connector_event (connection_id, event_type, message_id, occ_id, status, error)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [e.connectionId, e.eventType, e.messageId ?? null, e.occId ?? null, e.status, e.error ?? null],
  );
}

export interface ConnectorEventRow {
  id: string; eventType: string; messageId: string | null; occId: string | null;
  status: string; error: string | null; receivedAt: string;
}

export async function listEvents(pool: Pool, connectionId: string, limit = 50): Promise<ConnectorEventRow[]> {
  const r = await pool.query<{
    id: string; event_type: string; message_id: string | null; occ_id: string | null;
    status: string; error: string | null; received_at: string;
  }>(
    `SELECT id::text, event_type, message_id, occ_id::text, status, error, received_at
       FROM cdp.connector_event WHERE connection_id=$1 ORDER BY id DESC LIMIT $2`,
    [connectionId, Math.min(limit, 200)],
  );
  return r.rows.map((x) => ({
    id: x.id, eventType: x.event_type, messageId: x.message_id, occId: x.occ_id,
    status: x.status, error: x.error, receivedAt: x.received_at,
  }));
}

export interface ConnectorDeliveryInput {
  connectionId: string;
  runId?: string | null;
  occId?: string | null;
  channel: string;
  recipient?: string | null;
  status: "sent" | "failed" | "skipped_no_contact";
  providerMessageId?: string | null;
  error?: string | null;
  attempts?: number;
}

export async function recordDelivery(pool: Pool, d: ConnectorDeliveryInput): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO cdp.connector_delivery
       (connection_id, run_id, occ_id, channel, recipient, status, provider_message_id, error, attempts, delivered_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $6='sent' THEN now() ELSE NULL END)
     RETURNING id::text`,
    [
      d.connectionId, d.runId ?? null, d.occId ?? null, d.channel, d.recipient ?? null,
      d.status, d.providerMessageId ?? null, d.error ?? null, d.attempts ?? 1,
    ],
  );
  return r.rows[0]!.id;
}

export interface ConnectorDeliveryRow {
  id: string; runId: string | null; occId: string | null; channel: string; recipient: string | null;
  status: string; providerMessageId: string | null; error: string | null; attempts: number;
  createdAt: string; deliveredAt: string | null;
}

export async function listDeliveries(pool: Pool, connectionId: string, limit = 50): Promise<ConnectorDeliveryRow[]> {
  const r = await pool.query<{
    id: string; run_id: string | null; occ_id: string | null; channel: string; recipient: string | null;
    status: string; provider_message_id: string | null; error: string | null; attempts: number;
    created_at: string; delivered_at: string | null;
  }>(
    `SELECT id::text, run_id::text, occ_id::text, channel, recipient, status, provider_message_id,
            error, attempts, created_at, delivered_at
       FROM cdp.connector_delivery WHERE connection_id=$1 ORDER BY id DESC LIMIT $2`,
    [connectionId, Math.min(limit, 200)],
  );
  return r.rows.map((x) => ({
    id: x.id, runId: x.run_id, occId: x.occ_id, channel: x.channel, recipient: x.recipient,
    status: x.status, providerMessageId: x.provider_message_id, error: x.error, attempts: x.attempts,
    createdAt: x.created_at, deliveredAt: x.delivered_at,
  }));
}
