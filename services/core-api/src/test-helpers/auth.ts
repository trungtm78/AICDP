import { createHash } from "node:crypto";
import type { Test } from "supertest";
import { pool } from "../db/pool.js";

// Key admin dev được migration 006 seed sẵn (raw cố định) — dùng cho e2e mặc định.
export const ADMIN_KEY = "occ-dev-admin-key-2026";

/** Tạo (hoặc đảm bảo tồn tại) một API key với role cho test. Trả raw key. */
export async function ensureKey(name: string, role: string, rawKey: string): Promise<string> {
  const hash = createHash("sha256").update(rawKey).digest("hex");
  await pool.query(
    `INSERT INTO cdp.api_key (name, role, key_hash) VALUES ($1,$2,$3)
     ON CONFLICT (key_hash) DO NOTHING`,
    [name, role, hash],
  );
  return rawKey;
}

/** Gắn Authorization Bearer cho một request supertest. */
export function withAuth(req: Test, rawKey: string = ADMIN_KEY): Test {
  return req.set("Authorization", `Bearer ${rawKey}`);
}
