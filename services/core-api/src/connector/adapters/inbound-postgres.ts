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

async function defaultLookup(host: string): Promise<string[]> {
  return (await dns.promises.lookup(host, { all: true })).map((r) => r.address);
}

export interface PinHostOptions {
  lookup?: (host: string) => Promise<string[]>;
  allowPrivate?: boolean;
}

/**
 * Resolve-then-PIN chống SSRF + DNS-rebinding: resolve host, chặn nếu BẤT KỲ IP nội bộ, rồi
 * TRẢ VỀ IP đã validate để pg Client connect THẲNG tới IP đó (không để pg resolve LẠI hostname —
 * bịt khe TOCTOU giữa lúc kiểm và lúc kết nối). IP literal trả về chính nó. Khi allowPrivate
 * (CONNECTOR_ALLOW_PRIVATE_PULL=1, kho nội bộ self-host) -> bỏ kiểm, giữ nguyên host.
 */
export async function resolvePinnedHost(host: string, opts: PinHostOptions = {}): Promise<string> {
  const allowPrivate = opts.allowPrivate ?? process.env.CONNECTOR_ALLOW_PRIVATE_PULL === "1";
  if (net.isIP(host)) {
    if (!allowPrivate && isPrivateIp(host)) throw blocked(`IP nội bộ bị chặn (SSRF): ${host}.`);
    return host;
  }
  if (allowPrivate) return host; // self-host: tin hostname kho nội bộ
  const lookup = opts.lookup ?? defaultLookup;
  let ips: string[];
  try {
    ips = await lookup(host);
  } catch {
    throw blocked(`Không resolve được host nguồn: ${host}.`);
  }
  if (ips.length === 0) throw blocked(`Host nguồn không có bản ghi IP: ${host}.`);
  for (const ip of ips) {
    if (isPrivateIp(ip)) throw blocked(`Host reverse-ETL trỏ IP nội bộ ${ip} — chặn (SSRF/DNS-rebinding).`);
  }
  return ips[0]!; // PIN: connect tới IP đã validate, không resolve lại
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
    // allow-private theo TỪNG connection (config.allowInternalHost) HOẶC env blanket (dev/test).
    // Per-connection thu hẹp blast-radius so với công tắc toàn cục fail-open.
    const allowPrivate = config["allowInternalHost"] === true || process.env.CONNECTOR_ALLOW_PRIVATE_PULL === "1";
    const pinnedHost = await resolvePinnedHost(host, { allowPrivate });

    const table = quoteIdent(config["table"], "table");
    const cursorCol = quoteIdent(config["cursorColumn"], "cursorColumn");
    const mapping = (config["mapping"] ?? {}) as Obj;
    // Tie-breaker DUY NHẤT (vd PK 'id') để keyset không bỏ sót row khi cursorColumn trùng giá trị
    // (vd nhiều row cùng updated_at ở ranh giới batch). Không khai -> giả định cursorColumn đã unique.
    const hasTie = mapping["tieBreak"] !== undefined || config["tieBreakColumn"] !== undefined;
    const tieCol = hasTie ? quoteIdent(config["tieBreakColumn"] ?? mapping["tieBreak"], "tieBreakColumn") : "";

    // Cột SELECT: cursor (+tie) + pos_transaction_id + total (bắt buộc) + tuỳ chọn store_id/ts/phone/email.
    const cols: string[] = [
      `${cursorCol} AS __cursor`,
      `${quoteIdent(mapping["pos_transaction_id"], "mapping.pos_transaction_id")} AS pos_transaction_id`,
      `${quoteIdent(mapping["total"], "mapping.total")} AS total`,
    ];
    if (hasTie) cols.push(`${tieCol} AS __tie`);
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
      if (hasTie) {
        // Keyset composite: (cursor,tie) > ($1,$2) — so sánh hàng, an toàn khi cursor trùng.
        params.push(cur, cursor!["tie"] ?? null);
        where = `WHERE (${cursorCol}, ${tieCol}) > ($${params.length - 1}, $${params.length})`;
      } else {
        params.push(cur);
        where = `WHERE ${cursorCol} > $${params.length}`;
      }
    }
    params.push(batch);
    const orderBy = hasTie ? `${cursorCol} ASC, ${tieCol} ASC` : `${cursorCol} ASC`;
    const sql = `SELECT ${cols.join(", ")} FROM ${table} ${where} ORDER BY ${orderBy} LIMIT $${params.length}`;

    // TLS bắt buộc cho host công khai (mật khẩu + dữ liệu KH không đi plaintext); verify cert theo
    // hostname gốc (servername) dù connect tới IP đã pin. Kho nội bộ self-host (allowPrivate) hoặc
    // config.ssl===false mới tắt.
    const useSsl = !allowPrivate && config["ssl"] !== false;
    const client = new Client({
      host: pinnedHost,
      port: Number(config["port"]) || 5432,
      database: str(config["database"]),
      user: str(config["user"]),
      password: str(config["apiKey"]),
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
      query_timeout: 10000,
      ...(useSsl ? { ssl: { rejectUnauthorized: true, servername: host } } : {}),
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
        // total NULL -> undefined (zod báo thiếu -> rejected); KHÔNG ép 0 (nuốt data tiền).
        total: row["total"] == null ? undefined : Number(row["total"]),
      };
      const data: Obj = {
        type: "order_completed",
        store_id: str(row["store_id"]) ?? str(config["store_id"]) ?? "reverse_etl",
        properties,
      };
      const ts = toIso(row["occ_timestamp"]);
      if (ts) data["occ_timestamp"] = ts;
      if (identifiers.length > 0) data["identifiers"] = identifiers;
      const evCursor: Record<string, unknown> = { value: row["__cursor"] };
      if (hasTie) evCursor["tie"] = row["__tie"];
      return { type: "order_completed", data, cursor: evCursor };
    });

    // nextCursor = cursor của row CUỐI (dùng khi cả lô ingest thành công); runner sẽ tiến theo
    // per-event cursor nếu có lỗi giữa lô (không nhảy qua row rejected).
    const last = rows[rows.length - 1];
    const nextCursor =
      last !== undefined
        ? { value: last["__cursor"], ...(hasTie ? { tie: last["__tie"] } : {}) }
        : (cursor ?? null);
    return { events, nextCursor };
  },
};
