import type { Pool } from "pg";
import { AppError } from "../http/errors.js";
import { decryptConfig } from "./secrets.js";
import { getOutbound } from "./adapters/registry.js";
import { recordDelivery } from "./logs.service.js";
import type { OutboundMessage, OutboundDeps } from "./adapters/types.js";

// Giao hàng OUTBOUND THẬT tới 1 destination connection: giải mã config -> adapter.deliver (safeFetch
// SSRF-safe) -> ghi connector_delivery. Dùng bởi test-send + wiring activation/journey. Lỗi adapter
// KHÔNG ném ra ngoài (ghi delivery 'failed' + trả status) — 1 đích lỗi không làm sập cả lô.

export interface DeliverOutcome {
  deliveryId: string;
  status: "sent" | "failed" | "skipped_no_contact";
  error?: string;
}

export async function deliverToConnection(
  pool: Pool,
  connectionId: string,
  msg: OutboundMessage,
  deps?: OutboundDeps,
  runId?: string,
): Promise<DeliverOutcome> {
  const r = await pool.query<{
    direction: string; status: string; connector_key: string; config: Record<string, unknown>;
  }>(`SELECT direction, status, connector_key, config FROM cdp.connection WHERE id=$1`, [connectionId]);
  const row = r.rows[0];
  if (!row) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404, message: "Không tìm thấy kết nối.",
      why: "id không tồn tại.", fix: "Kiểm tra lại id.", retryable: false,
    });
  }
  if (row.direction !== "destination") {
    throw new AppError({
      code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: "Chỉ gửi qua kết nối đích (destination).",
      why: "Connection này là source.", fix: "Chọn một destination connection.", retryable: false,
    });
  }
  const adapter = getOutbound(row.connector_key);
  if (!adapter) {
    throw new AppError({
      code: "INTEGRATION_NOT_AVAILABLE", httpStatus: 400,
      message: `Connector '${row.connector_key}' chưa cài adapter gửi (chưa setup).`,
      why: "Connector này thuộc nhóm chưa setup (chưa có OutboundAdapter).",
      fix: "Chọn connector đã setup, hoặc yêu cầu cài tích hợp.", retryable: false,
    });
  }

  const config = decryptConfig(row.config ?? {});
  let status: DeliverOutcome["status"];
  let providerMessageId: string | null = null;
  let error: string | null = null;
  try {
    const res = await adapter.deliver(config, msg, deps);
    status = res.status; // 'sent' | 'failed'
    providerMessageId = res.providerMessageId ?? null;
    error = res.error ?? null;
  } catch (e) {
    // Adapter tự bắt lỗi mạng, nhưng phòng exception ngoài ý muốn -> vẫn ghi 'failed' (không lộ chi tiết).
    status = "failed";
    error = (e as Error).message;
  }

  const deliveryId = await recordDelivery(pool, {
    connectionId,
    runId: runId ?? null,
    occId: msg.occId ?? null,
    channel: msg.channel,
    recipient: msg.recipient ?? null,
    status,
    providerMessageId,
    error,
  });
  return { deliveryId, status, ...(error ? { error } : {}) };
}

// ── Wiring activation → OUTBOUND ──
export interface ActivationDeliverSummary {
  runId: string;
  total: number; // số member allowed
  sent: number;
  failed: number;
  skipped: number;
}

/**
 * Giao hàng cho các member ĐƯỢC PHÉP (consent) của 1 activation_run tới 1 destination connection.
 * Tách khỏi transaction activate() (post-commit side-effect): consent đã gate lúc activate. Mỗi
 * member -> deliverToConnection (recipient = phone/email từ profile); ghi connector_delivery gắn run_id.
 * Lỗi 1 member KHÔNG dừng cả lô. Idempotency giao hàng thật (chống gửi trùng) là hardening outbox sau.
 */
export async function deliverActivationRun(
  pool: Pool,
  runId: string,
  connectionId: string,
  deps?: OutboundDeps,
): Promise<ActivationDeliverSummary> {
  const run = await pool.query<{ channel: string; audience_name: string }>(
    "SELECT channel, audience_name FROM cdp.activation_run WHERE run_id=$1",
    [runId],
  );
  if (run.rowCount === 0) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404, message: "Không tìm thấy activation run.",
      why: "runId không tồn tại.", fix: "Kiểm tra lại runId.", retryable: false,
    });
  }
  const channel = run.rows[0]!.channel;
  const audienceName = run.rows[0]!.audience_name;

  const members = await pool.query<{ occ_id: string; phone: string | null; email: string | null }>(
    `SELECT m.occ_id, p.phone, p.email
       FROM cdp.activation_member m
       LEFT JOIN cdp.profile p ON p.occ_id = m.occ_id
      WHERE m.run_id=$1 AND m.decision='allowed'`,
    [runId],
  );

  let sent = 0, failed = 0, skipped = 0;
  for (const m of members.rows) {
    const recipient = m.phone ?? m.email ?? undefined;
    const msg: OutboundMessage = {
      channel,
      occId: m.occ_id,
      payload: { audience: audienceName, run_id: runId, occ_id: m.occ_id },
      ...(recipient ? { recipient } : {}),
    };
    const out = await deliverToConnection(pool, connectionId, msg, deps, runId);
    if (out.status === "sent") sent += 1;
    else if (out.status === "skipped_no_contact") skipped += 1;
    else failed += 1;
  }
  return { runId, total: members.rows.length, sent, failed, skipped };
}
