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
  if (!row || !row.inbound_token_hash) throw unauthorized("Cổng vào chưa cấu hình token.");
  if (!token || !timingSafeEqualStr(sha256hex(token), row.inbound_token_hash)) {
    throw unauthorized("Token cổng vào không hợp lệ.");
  }
  if (row.status !== "active") throw unauthorized("Kết nối đang tạm dừng (không nhận dữ liệu).");
  return { id: row.id, connectorKey: row.connector_key, config: row.config ?? {} };
}
