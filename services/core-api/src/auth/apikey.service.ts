import { randomBytes, createHash } from "node:crypto";
import type { Pool } from "pg";
import type { Role } from "../http/auth/roles.js";

// Quản lý API key (service-to-service). Lưu băm sha256; trả raw MỘT lần khi tạo.

export interface ApiKeySummary {
  id: string;
  name: string;
  role: Role;
  status: string;
  created_at: string;
}

export async function listApiKeys(pool: Pool): Promise<ApiKeySummary[]> {
  const r = await pool.query<ApiKeySummary>(
    `SELECT id::text AS id, name, role, status, created_at
       FROM cdp.api_key ORDER BY created_at DESC`,
  );
  return r.rows;
}

export async function createApiKey(
  pool: Pool,
  a: { name: string; role: Role },
): Promise<{ id: string; name: string; role: Role; rawKey: string }> {
  const rawKey = `occ_${randomBytes(24).toString("base64url")}`;
  const hash = createHash("sha256").update(rawKey).digest("hex");
  const r = await pool.query<{ id: string }>(
    `INSERT INTO cdp.api_key (name, role, key_hash) VALUES ($1,$2,$3) RETURNING id::text AS id`,
    [a.name, a.role, hash],
  );
  return { id: r.rows[0]!.id, name: a.name, role: a.role, rawKey };
}

export async function revokeApiKey(pool: Pool, id: string): Promise<void> {
  await pool.query("UPDATE cdp.api_key SET status='revoked' WHERE id=$1", [Number(id)]);
}
