import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Pool } from "pg";

const here = dirname(fileURLToPath(import.meta.url));
// services/core-api/src/db -> repo root db/migrations
const migrationsDir = join(here, "../../../../db/migrations");

/** Chạy mọi migration .sql theo thứ tự tên. Migrations idempotent (IF NOT EXISTS). */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = await readFile(join(migrationsDir, f), "utf8");
    await pool.query(sql);
  }
  return files;
}
