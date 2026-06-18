import type { Pool } from "pg";
import { hashPassword, verifyPassword } from "./password.js";
import { signJwt } from "./jwt.js";
import { getJwtSecret } from "./jwt-secret.js";
import type { Role } from "../http/auth/roles.js";

// Hash giả cố định (mật khẩu ngẫu nhiên) để verify khi user không tồn tại -> cân bằng timing.
const DUMMY_HASH = hashPassword("occ-cdp-dummy-password-for-timing");

export interface CreateUserArgs {
  username: string;
  password: string;
  role: Role;
  name: string;
}

export interface LoginResult {
  token: string;
  role: Role;
  name: string;
}

export async function createUser(
  pool: Pool,
  a: CreateUserArgs,
): Promise<{ id: string; username: string; role: Role }> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO cdp.app_user (username, password_hash, role, name)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [a.username, hashPassword(a.password), a.role, a.name],
  );
  return { id: r.rows[0]!.id, username: a.username, role: a.role };
}

/** Xác thực username/password -> JWT. Trả null nếu sai (controller map 401). */
export async function login(
  pool: Pool,
  username: string,
  password: string,
): Promise<LoginResult | null> {
  const r = await pool.query<{ id: string; password_hash: string; role: Role; name: string }>(
    "SELECT id, password_hash, role, name FROM cdp.app_user WHERE username=$1 AND status='active'",
    [username],
  );
  const u = r.rows[0];
  if (!u) {
    // Verify hash giả để cân bằng thời gian (chống user-enumeration qua timing).
    verifyPassword(password, DUMMY_HASH);
    return null;
  }
  if (!verifyPassword(password, u.password_hash)) return null;
  const token = signJwt({ sub: u.id, role: u.role, name: u.name }, getJwtSecret());
  return { token, role: u.role, name: u.name };
}
