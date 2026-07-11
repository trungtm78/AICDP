import { randomBytes, createHash } from "node:crypto";
import type { Pool } from "pg";
import { timingSafeEqualStr } from "./signing.js";
import { AppError } from "../http/errors.js";

// Token cổng vào cho source webhook: sinh raw 24-byte reveal 1 LẦN, lưu sha256. Xác thực inbound
// so hash constant-time (chống timing) + connection phải active + direction=source (chống spoof).

function unauthorized(msg: string): AppError {
  return new AppError({
    code: "CONNECTOR_UNAUTHORIZED", httpStatus: 401, message: msg,
    why: "Token cổng vào sai/thiếu, hoặc kết nối không ở trạng thái nhận.",
    fix: "Dùng đúng token đã cấp (X-Connector-Token) cho một source đang active.",
    retryable: false,
  });
}

const sha256hex = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Sinh token cổng vào cho 1 source connection. Trả RAW (reveal 1 lần); DB chỉ lưu sha256. */
export async function issueInboundToken(pool: Pool, connectionId: string): Promise<string> {
  const raw = randomBytes(24).toString("base64url");
  const r = await pool.query(
    `UPDATE cdp.connection SET inbound_token_hash=$2, updated_at=now()
       WHERE id=$1 AND direction='source' RETURNING id`,
    [connectionId, sha256hex(raw)],
  );
  if (r.rowCount === 0) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404,
      message: "Không tìm thấy source connection để cấp token.",
      why: "Connection không tồn tại hoặc không phải direction=source.",
      fix: "Chỉ cấp token cổng vào cho connector nguồn (source).", retryable: false,
    });
  }
  return raw;
}

export interface ResolvedInbound {
  id: string;
  connectorKey: string;
  config: Record<string, unknown>;
}

/** Xác thực token cổng vào -> trả connection (source, active). Ném 401 nếu không hợp lệ. */
export async function resolveInboundConnection(
  pool: Pool,
  connectionId: string,
  token: string,
): Promise<ResolvedInbound> {
  const r = await pool.query<{
    id: string; connector_key: string; config: Record<string, unknown>;
    status: string; inbound_token_hash: string | null;
  }>(
    `SELECT id, connector_key, config, status, inbound_token_hash
       FROM cdp.connection WHERE id=$1 AND direction='source'`,
    [connectionId],
  );
  const row = r.rows[0];
  // Message ĐỒNG NHẤT cho mọi nhánh chưa-auth (không tồn tại / chưa cấu hình token / sai token)
  // -> không cho kẻ chưa xác thực phân biệt "UUID này là source đã cấu hình" (chống oracle).
  // TIMING: LUÔN chạy sha256 + so sánh constant-time (với hash giả nếu thiếu) để thời gian đồng nhất
  // giữa "id không tồn tại" và "id là source có token" (bịt timing-oracle enumerate UUID).
  const DUMMY_HASH = "0".repeat(64);
  const match = timingSafeEqualStr(sha256hex(token || ""), row?.inbound_token_hash ?? DUMMY_HASH);
  if (!row || !row.inbound_token_hash || !token || !match) {
    throw unauthorized("Token cổng vào không hợp lệ.");
  }
  // Chỉ tới đây (đã xác thực token đúng) mới lộ trạng thái paused — an toàn (caller sở hữu token).
  if (row.status !== "active") throw unauthorized("Kết nối đang tạm dừng (không nhận dữ liệu).");
  return { id: row.id, connectorKey: row.connector_key, config: row.config ?? {} };
}

/**
 * Xác thực theo write-key (shape Segment/RudderStack SDK): tra source connection có
 * config.writeKey khớp. writeKey là khoá định tuyến (không phải secret ở model Segment) nên
 * lưu plaintext trong config -> tra bằng equality. 401 ĐỒNG NHẤT (message giống nhau) khi
 * thiếu/không khớp/không active/TRÙNG (chống oracle enumeration). So sánh trong DB (không
 * constant-time từng byte) — chấp nhận vì writeKey là routing key; flood chặn bởi rate-limit + edge WAF.
 * CHỐNG VA CHẠM: nếu >1 source active cùng writeKey -> TỪ CHỐI (không định tuyến nhầm brand theo
 * created_at). writeKey nên UNIQUE ở tầng cấu hình.
 */
export async function resolveWriteKeyConnection(
  pool: Pool,
  writeKey: string,
): Promise<ResolvedInbound> {
  if (!writeKey) throw unauthorized("Write-key không hợp lệ.");
  const r = await pool.query<{
    id: string; connector_key: string; config: Record<string, unknown>; status: string;
  }>(
    `SELECT id, connector_key, config, status
       FROM cdp.connection
      WHERE direction='source' AND status='active' AND config->>'writeKey' = $1`,
    [writeKey],
  );
  // Đúng 1 source active khớp mới định tuyến; 0 -> sai key; >1 -> va chạm cấu hình (từ chối, không đoán).
  if (r.rows.length !== 1) throw unauthorized("Write-key không hợp lệ.");
  const row = r.rows[0]!;
  return { id: row.id, connectorKey: row.connector_key, config: row.config ?? {} };
}
