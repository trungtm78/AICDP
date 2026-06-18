import { createClient, type ClickHouseClient } from "@clickhouse/client";

// Client ClickHouse (OLAP). Cấu hình từ env, khớp .env.example / docker-compose (HTTP :8123, db occ_cdp).
// request_timeout ngắn để khi CH chậm/không tới được thì FAIL NHANH (fallback PG/best-effort), không treo.

export type Ch = ClickHouseClient;

export interface ChOptions {
  url?: string;
  database?: string;
  username?: string;
  password?: string;
  requestTimeoutMs?: number;
}

export function createCh(opts: ChOptions = {}): Ch {
  return createClient({
    url: opts.url ?? process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
    database: opts.database ?? process.env.CLICKHOUSE_DB ?? "occ_cdp",
    username: opts.username ?? process.env.CLICKHOUSE_USER ?? "default",
    password: opts.password ?? process.env.CLICKHOUSE_PASSWORD ?? "",
    request_timeout: opts.requestTimeoutMs ?? 2500,
  });
}

// Client dùng chung cho runtime (HTTP). Tạo lazy để import module không mở kết nối.
let shared: Ch | null = null;
export function sharedCh(): Ch {
  if (!shared) shared = createCh();
  return shared;
}
