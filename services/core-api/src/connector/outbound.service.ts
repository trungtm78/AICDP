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
    occId: msg.occId ?? null,
    channel: msg.channel,
    recipient: msg.recipient ?? null,
    status,
    providerMessageId,
    error,
  });
  return { deliveryId, status, ...(error ? { error } : {}) };
}
