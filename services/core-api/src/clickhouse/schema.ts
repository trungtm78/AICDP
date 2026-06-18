import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Ch } from "./client.js";

const here = dirname(fileURLToPath(import.meta.url));
// services/core-api/src/clickhouse -> repo root db/clickhouse
const ddlDir = join(here, "../../../../db/clickhouse");

/**
 * Bootstrap schema ClickHouse: chạy mọi .sql trong db/clickhouse theo thứ tự tên.
 * DDL idempotent (CREATE TABLE IF NOT EXISTS). Mỗi câu lệnh chạy riêng (CH command 1 stmt/lần).
 */
export async function ensureClickhouseSchema(ch: Ch): Promise<void> {
  const files = (await readdir(ddlDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = await readFile(join(ddlDir, f), "utf8");
    for (const stmt of splitStatements(sql)) {
      await ch.command({ query: stmt });
    }
  }
}

/** Tách câu lệnh theo ';', bỏ comment dòng (-- ...) và khoảng trắng thừa. */
function splitStatements(sql: string): string[] {
  const noComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return noComments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
