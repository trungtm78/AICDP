import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { hashPassword } from "./password.js";

// Quên mật khẩu (demo-grade): token THẬT (ngẫu nhiên 256-bit, lưu băm sha256, hết hạn 30',
// dùng 1 lần, chống dò tài khoản) — chỉ KÊNH GIAO token là demo (controller quyết định lộ ra
// khi CORE_API_DEMO_RESET=1 thay vì gửi email).

const RESET_TTL_MINUTES = 30;

export class PasswordResetError extends Error {
  readonly code = "RESET_TOKEN_INVALID";
  constructor(message = "Link đặt lại không hợp lệ, đã hết hạn hoặc đã được sử dụng.") {
    super(message);
    this.name = "PasswordResetError";
  }
}

export interface RequestResetResult {
  ok: true;
  /** Chỉ có khi user tồn tại & active — caller quyết định có lộ ra ngoài hay không. */
  token?: string;
}

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Tạo yêu cầu đặt lại. LUÔN trả ok:true (không tiết lộ tài khoản có tồn tại hay không). */
export async function requestReset(pool: Pool, username: string): Promise<RequestResetResult> {
  const u = await pool.query<{ id: string }>(
    "SELECT id FROM cdp.app_user WHERE username=$1 AND status='active'",
    [username],
  );
  const userId = u.rows[0]?.id;
  if (!userId) return { ok: true };

  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO cdp.password_reset (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval)`,
    [userId, sha256(token), String(RESET_TTL_MINUTES)],
  );
  return { ok: true, token };
}

/** Đặt mật khẩu mới theo token (một lần). Ném PasswordResetError nếu token sai/hết hạn/đã dùng. */
export async function confirmReset(pool: Pool, token: string, newPassword: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Khoá dòng token + đánh dấu đã dùng atomically (điều kiện chưa dùng & còn hạn).
    const r = await client.query<{ user_id: string }>(
      `UPDATE cdp.password_reset
          SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [sha256(token)],
    );
    const userId = r.rows[0]?.user_id;
    if (!userId) {
      await client.query("ROLLBACK");
      throw new PasswordResetError();
    }
    await client.query("UPDATE cdp.app_user SET password_hash=$2 WHERE id=$1", [
      userId,
      hashPassword(newPassword),
    ]);
    await client.query("COMMIT");
  } catch (err) {
    // ROLLBACK an toàn nếu transaction còn mở (PasswordResetError đã tự rollback ở trên).
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
