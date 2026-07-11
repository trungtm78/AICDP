import type { Pool } from "pg";
import { getConnectionConfigDecrypted } from "./connector.service.js";
import { getOutbound } from "./adapters/registry.js";
import { AppError } from "../http/errors.js";

// Health-check THẬT 1 connection: giải mã config -> gọi adapter.healthCheck (probe thật tới đích)
// -> cập nhật status/last_checked_at/last_error. Không có adapter -> INTEGRATION_NOT_AVAILABLE
// (connector "chưa setup" — KHÔNG giả success).

export interface TestResult {
  ok: boolean;
  status: "active" | "error";
  error?: string;
}

export async function testConnection(pool: Pool, id: string): Promise<TestResult> {
  const c = await getConnectionConfigDecrypted(pool, id);
  if (!c) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404, message: "Không tìm thấy kết nối.",
      why: "id không tồn tại.", fix: "Kiểm tra lại id.", retryable: false,
    });
  }
  const adapter = getOutbound(c.connectorKey);
  if (!adapter) {
    throw new AppError({
      code: "INTEGRATION_NOT_AVAILABLE", httpStatus: 400,
      message: `Connector '${c.connectorKey}' chưa cài adapter (chưa setup).`,
      why: "Connector này thuộc nhóm 'chưa setup' (chưa có adapter thật).",
      fix: "Chọn connector đã setup, hoặc yêu cầu cài đặt tích hợp.", retryable: false,
    });
  }

  let ok = false;
  let clientError: string | undefined;  // an toàn để trả client
  let dbError: string | undefined;      // chi tiết -> chỉ lưu server-side (last_error)
  try {
    const h = await adapter.healthCheck(c.config);
    ok = h.ok;
    // HealthResult.error do adapter của ta tạo (đã kiểm soát an toàn) -> trả được.
    clientError = h.error;
    dbError = h.error;
  } catch (e) {
    // Exception THÔ (vd 'connect ECONNREFUSED 10.x', '401 Bearer sk_...') có thể chứa
    // IP nội bộ/credential -> KHÔNG trả nguyên ra client; chỉ lưu server-side.
    ok = false;
    dbError = (e as Error).message;
    clientError = "Kiểm tra kết nối thất bại (xem nhật ký hệ thống).";
  }

  const status: "active" | "error" = ok ? "active" : "error";
  await pool.query(
    `UPDATE cdp.connection SET status=$2, last_checked_at=now(), last_error=$3, updated_at=now() WHERE id=$1`,
    [id, status, ok ? null : (dbError ?? "health-check thất bại")],
  );
  return clientError !== undefined ? { ok, status, error: clientError } : { ok, status };
}
