import net from "node:net";
import dns from "node:dns";
import { Client } from "pg";
import { AppError } from "../../http/errors.js";
import { isPrivateIp } from "../ssrf-guard.js";
import type { InboundPullAdapter, PulledEvent } from "./types.js";

// Adapter INBOUND kiểu PULL cho PostgreSQL nguồn (reverse-ETL). BẢO MẬT (threat-model P0):
// - CHỈ-SELECT: câu lệnh do adapter dựng từ identifier ĐÃ validate (KHÔNG nhận SQL thô của user);
//   chạy trong transaction READ ONLY + statement_timeout -> không thể ghi/DDL/side-effect.
// - Host-guard chống SSRF: chặn kết nối tới IP nội bộ/metadata (trừ khi CONNECTOR_ALLOW_PRIVATE_PULL=1
//   cho kho nội bộ self-host). Ngăn dùng reverse-ETL để chọc DB hạ tầng nội bộ.
// - Giá trị cursor tham số hoá ($1) — không nội suy chuỗi.

type Obj = Record<string, unknown>;

function misconfigured(msg: string): AppError {
  return new AppError({
    code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: msg,
    why: "Cấu hình reverse-ETL không hợp lệ.",
    fix: "Kiểm tra host/table/cursorColumn/mapping của kết nối nguồn.", retryable: false,
  });
}
function blocked(msg: string): AppError {
  return new AppError({
    code: "CONNECTOR_URL_BLOCKED", httpStatus: 400, message: msg,
    why: "Host nguồn bị chặn bởi chính sách chống SSRF.",
    fix: "Dùng host kho dữ liệu công khai, hoặc bật CONNECTOR_ALLOW_PRIVATE_PULL cho kho nội bộ.",
    retryable: false,
  });
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Trích-dẫn an toàn identifier (cột/bảng), cho phép dạng schema.table. Ném nếu ký tự lạ. */
function quoteIdent(raw: unknown, what: string): string {
  const s = str(raw);
  if (!s) throw misconfigured(`Thiếu ${what}.`);
  const parts = s.split(".");
  if (parts.length > 2 || parts.some((p) => !IDENT_RE.test(p))) {
    throw misconfigured(`Identifier không hợp lệ cho ${what}: '${s}'.`);
  }
  return parts.map((p) => `"${p}"`).join(".");
}

/** Chặn kết nối tới hạ tầng nội bộ (SSRF). Bỏ qua khi CONNECTOR_ALLOW_PRIVATE_PULL=1 (self-host). */
async function assertPullHostAllowed(host: string): Promise<void> {
  if (process.env.CONNECTOR_ALLOW_PRIVATE_PULL === "1") return;
  let ips: string[];
  if (net.isIP(host)) ips = [host];
  else {
    try {
      ips = (await dns.promises.lookup(host, { all: true })).map((r) => r.address);
    } catch {
      throw blocked(`Không resolve được host nguồn: ${host}.`);
    }
  }
  if (ips.length === 0) throw blocked(`Host nguồn không có bản ghi IP: ${host}.`);
  for (const ip of ips) {
    if (isPrivateIp(ip)) throw blocked(`Host reverse-ETL trỏ IP nội bộ ${ip} — chặn (SSRF).`);
  }
}

function toIso(v: unknown): string | undefined {
  if (v instanceof Date) return v.toISOString();
  const s = str(v);
  if (s && /^\d{4}-\d{2}-\d{2}[T ]/.test(s)) return s;
  return undefined;
}

const MAX_BATCH = 1000;
const DEFAULT_BATCH = 100;

export const postgresInboundAdapter: InboundPullAdapter = {
  key: "src_pg",
  async pull(config, cursor) {
    const host = str(config["host"]);
    if (!host) throw misconfigured("Thiếu host kho nguồn.");
    await assertPullHostAllowed(host);

    const table = quoteIdent(config["table"], "table");
    const cursorCol = quoteIdent(config["cursorColumn"], "cursorColumn");
    const mapping = (config["mapping"] ?? {}) as Obj;

    // Cột SELECT: cursor + pos_transaction_id + total (bắt buộc) + tuỳ chọn store_id/ts/phone/email.
    const cols: string[] = [
      `${cursorCol} AS __cursor`,
      `${quoteIdent(mapping["pos_transaction_id"], "mapping.pos_transaction_id")} AS pos_transaction_id`,
      `${quoteIdent(mapping["total"], "mapping.total")} AS total`,
    ];
    const optional: Array<[string, string]> = [
      ["store_id", "store_id"], ["occ_timestamp", "occ_timestamp"], ["phone", "phone"], ["email", "email"],
    ];
    for (const [key, alias] of optional) {
      if (mapping[key] !== undefined) cols.push(`${quoteIdent(mapping[key], `mapping.${key}`)} AS ${alias}`);
    }

    const batch = Math.min(MAX_BATCH, Math.max(1, Number(config["batchSize"]) || DEFAULT_BATCH));
    const params: unknown[] = [];
    let where = "";
    const cur = cursor && cursor["value"] !== undefined && cursor["value"] !== null ? cursor["value"] : null;
    if (cur !== null) {
      params.push(cur);
      where = `WHERE ${cursorCol} > $${params.length}`;
    }
    params.push(batch);
    const sql = `SELECT ${cols.join(", ")} FROM ${table} ${where} ORDER BY ${cursorCol} ASC LIMIT $${params.length}`;

    const client = new Client({
      host,
      port: Number(config["port"]) || 5432,
      database: str(config["database"]),
      user: str(config["user"]),
      password: str(config["apiKey"]),
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      query_timeout: 10000,
    });
    await client.connect();
    let rows: Array<Record<string, unknown>>;
    try {
      // READ ONLY: chốt cứng không-ghi kể cả nếu ai đó chèn hàm side-effect.
      await client.query("BEGIN TRANSACTION READ ONLY");
      const r = await client.query<Record<string, unknown>>(sql, params);
      await client.query("COMMIT");
      rows = r.rows;
    } finally {
      await client.end();
    }

    const events: PulledEvent[] = rows.map((row) => {
      const identifiers: Array<{ type: string; value: string }> = [];
      const phone = str(row["phone"]);
      const email = str(row["email"]);
      if (phone) identifiers.push({ type: "phone", value: phone });
      if (email) identifiers.push({ type: "email", value: email });
      const properties: Obj = {
        pos_transaction_id: row["pos_transaction_id"] == null ? undefined : String(row["pos_transaction_id"]),
        total: Number(row["total"]),
      };
      const data: Obj = {
        type: "order_completed",
        store_id: str(row["store_id"]) ?? str(config["store_id"]) ?? "reverse_etl",
        properties,
      };
      const ts = toIso(row["occ_timestamp"]);
      if (ts) data["occ_timestamp"] = ts;
      if (identifiers.length > 0) data["identifiers"] = identifiers;
      return { type: "order_completed", data };
    });

    const nextCursor =
      rows.length > 0 ? { value: rows[rows.length - 1]!["__cursor"] as unknown } : (cursor ?? null);
    return { events, nextCursor };
  },
};
