import type { Pool } from "pg";
import { AppError } from "../http/errors.js";
import { decryptConfig } from "./secrets.js";
import { getOutbound } from "./adapters/registry.js";
import { recordDelivery } from "./logs.service.js";
import { isAllowed } from "../consent/consent.service.js";
import type { OutboundMessage, OutboundDeps } from "./adapters/types.js";

// Giao hàng OUTBOUND THẬT tới 1 destination connection: giải mã config -> adapter.deliver (safeFetch
// SSRF-safe) -> ghi connector_delivery. Dùng bởi test-send + wiring activation/journey. Lỗi adapter
// KHÔNG ném ra ngoài (ghi delivery 'failed' + trả status) — 1 đích lỗi không làm sập cả lô.

export interface DeliverOutcome {
  deliveryId: string;
  status: "sent" | "failed" | "skipped_no_contact";
  error?: string;
}

// Chuẩn hoá error trả ra ngoài: xoá URL (có thể chứa token/endpoint nội bộ) + IP (v4/v6, error
// SSRF-guard chứa IP nội bộ đã resolve) -> chống dùng test-send/deliveries làm công cụ dò mạng/rò
// credential. Chi tiết đầy đủ chỉ ở log tiến trình. Cắt độ dài để tránh nhồi dữ liệu.
const URL_RE = /https?:\/\/\S+/gi;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;
function redactError(msg: string | null): string | null {
  if (msg == null) return null;
  return msg.replace(URL_RE, "[url]").replace(IP_RE, "[ip]").slice(0, 300);
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
    status = res.status; // 'sent' | 'failed' | 'skipped_no_contact'
    providerMessageId = res.providerMessageId ?? null;
    error = res.error ?? null;
  } catch (e) {
    // Adapter tự bắt lỗi mạng, nhưng phòng exception ngoài ý muốn -> vẫn ghi 'failed'.
    status = "failed";
    error = (e as Error).message;
  }
  // REDACT IP khỏi error trước khi lưu/trả (error SSRF-guard chứa IP nội bộ đã resolve -> chống
  // dùng test-send/deliveries làm công cụ dò mạng nội bộ). Chi tiết đầy đủ chỉ ở log tiến trình.
  error = redactError(error);

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
  total: number; // số member allowed (snapshot lúc activate)
  sent: number;
  failed: number;
  skipped: number; // không có contact (phone/email)
  suppressed: number; // consent đã RÚT sau activate -> KHÔNG gửi (deny-by-default lúc gửi)
  alreadySent: number; // đã gửi thành công lần trước (idempotent -> KHÔNG gửi lại)
}

/**
 * Giao hàng cho các member ĐƯỢC PHÉP của 1 activation_run tới 1 destination connection. Tách khỏi
 * transaction activate() (post-commit side-effect). CONSENT RE-CHECK lúc gửi: activate() gate consent
 * tại thời điểm tạo run, nhưng deliver có thể chạy MUCH LATER -> phải kiểm isAllowed LẠI (latest-wins)
 * để tôn trọng KH đã RÚT consent trong khoảng giữa (deny-by-default; chống gửi lố sau khi withdraw).
 * Mỗi member -> deliverToConnection (recipient = phone/email); ghi connector_delivery gắn run_id.
 * Lỗi 1 member KHÔNG dừng cả lô. Idempotency giao hàng thật là hardening outbox sau.
 */
export async function deliverActivationRun(
  pool: Pool,
  runId: string,
  connectionId: string,
  deps?: OutboundDeps,
): Promise<ActivationDeliverSummary> {
  const run = await pool.query<{ channel: string; audience_name: string; purpose: string }>(
    "SELECT channel, audience_name, purpose FROM cdp.activation_run WHERE run_id=$1",
    [runId],
  );
  if (run.rowCount === 0) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404, message: "Không tìm thấy activation run.",
      why: "runId không tồn tại.", fix: "Kiểm tra lại runId.", retryable: false,
    });
  }
  const { channel, audience_name: audienceName, purpose } = run.rows[0]!;

  const members = await pool.query<{ occ_id: string; phone: string | null; email: string | null }>(
    `SELECT m.occ_id, p.phone, p.email
       FROM cdp.activation_member m
       LEFT JOIN cdp.profile p ON p.occ_id = m.occ_id
      WHERE m.run_id=$1 AND m.decision='allowed'`,
    [runId],
  );

  // Idempotency chống double-send (double-click/retry): bỏ qua member đã 'sent' cho (run, connection).
  const prior = await pool.query<{ occ_id: string }>(
    `SELECT DISTINCT occ_id FROM cdp.connector_delivery
      WHERE run_id=$1 AND connection_id=$2 AND status='sent' AND occ_id IS NOT NULL`,
    [runId, connectionId],
  );
  const alreadySentSet = new Set(prior.rows.map((r) => r.occ_id));

  let sent = 0, failed = 0, skipped = 0, suppressed = 0, alreadySent = 0;
  for (const m of members.rows) {
    if (alreadySentSet.has(m.occ_id)) { alreadySent += 1; continue; } // đã gửi -> không gửi lại
    // Re-check consent tại thời điểm gửi (latest-wins) — tôn trọng withdraw sau activate.
    if (!(await isAllowed(pool, m.occ_id, purpose))) { suppressed += 1; continue; }
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
  return { runId, total: members.rows.length, sent, failed, skipped, suppressed, alreadySent };
}
