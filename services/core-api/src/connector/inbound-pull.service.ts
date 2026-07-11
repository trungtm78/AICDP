import type { Pool } from "pg";
import { AppError } from "../http/errors.js";
import { decryptConfig } from "./secrets.js";
import { getInboundPull } from "./adapters/registry.js";
import { ingestInboundEvent } from "./inbound-ingest.service.js";
import type { ResolvedInbound } from "./inbound.service.js";

// Runner reverse-ETL: đọc cursor -> adapter.pull (SELECT-only) -> nạp từng event qua ingestInboundEvent
// (validate + ghi connector_event) -> tiến pull_cursor TỚI row đã xử lý xong. Admin/data_steward
// kích hoạt (POST /connections/:id/pull). brand_id lấy từ connection (chống spoof).
//
// Bảo đảm (từ review cross-model):
// - advisory-lock per-connection: chống 2 pull đồng thời (trùng ingest + cursor regression).
// - CHỈ pull connection status='active' (nhất quán với cổng webhook).
// - Tiến cursor tới row THÀNH CÔNG cuối, DỪNG ở lỗi đầu tiên -> KHÔNG nhảy qua row rejected
//   (không mất dữ liệu; row lỗi sẽ được pull lại — poison row hiện rõ pulled>0/ingested=0).

export interface PullSummary {
  pulled: number;
  ingested: number;
  rejected: number;
  cursor: Record<string, unknown> | null;
}

const LOCK_KEY = (id: string): string => `connector-pull:${id}`;

export async function pullConnection(pool: Pool, connectionId: string): Promise<PullSummary> {
  const client = await pool.connect();
  try {
    // Advisory lock SESSION-level trên client này — serialize pull cùng connection.
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [LOCK_KEY(connectionId)],
    );
    if (!lock.rows[0]?.locked) {
      throw new AppError({
        code: "CONNECTOR_PULL_BUSY", httpStatus: 409,
        message: "Đang có một lần pull khác chạy cho kết nối này.",
        why: "Advisory lock per-connection đang bị giữ.", fix: "Thử lại sau khi lần pull hiện tại xong.",
        retryable: true,
      });
    }
    try {
      return await runPull(pool, connectionId);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [LOCK_KEY(connectionId)]);
    }
  } finally {
    client.release();
  }
}

async function runPull(pool: Pool, connectionId: string): Promise<PullSummary> {
  const r = await pool.query<{
    direction: string; status: string; connector_key: string;
    config: Record<string, unknown>; pull_cursor: Record<string, unknown> | null;
  }>(
    `SELECT direction, status, connector_key, config, pull_cursor FROM cdp.connection WHERE id=$1`,
    [connectionId],
  );
  const row = r.rows[0];
  if (!row) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404, message: "Không tìm thấy kết nối.",
      why: "id không tồn tại.", fix: "Kiểm tra lại id.", retryable: false,
    });
  }
  if (row.direction !== "source") {
    throw new AppError({
      code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: "Chỉ kéo dữ liệu từ kết nối nguồn (source).",
      why: "Connection này là destination.", fix: "Chọn một source connection để pull.", retryable: false,
    });
  }
  if (row.status !== "active") {
    throw new AppError({
      code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: "Kết nối không ở trạng thái active.",
      why: `status='${row.status}' (paused/draft/error không nhận pull).`,
      fix: "Kích hoạt kết nối (status=active) rồi pull lại.", retryable: false,
    });
  }
  const adapter = getInboundPull(row.connector_key);
  if (!adapter) {
    throw new AppError({
      code: "INTEGRATION_NOT_AVAILABLE", httpStatus: 400,
      message: `Connector '${row.connector_key}' chưa hỗ trợ pull (reverse-ETL).`,
      why: "Connector này chưa có adapter inbound-pull.",
      fix: "Dùng connector nguồn hỗ trợ reverse-ETL (vd src_pg).", retryable: false,
    });
  }

  const config = decryptConfig(row.config ?? {});
  const { events, nextCursor } = await adapter.pull(config, row.pull_cursor ?? null);

  const resolved: ResolvedInbound = { id: connectionId, connectorKey: row.connector_key, config };
  let ingested = 0;
  let rejected = 0;
  let advanceTo: Record<string, unknown> | null = null;
  let stopped = false;
  for (const ev of events) {
    try {
      await ingestInboundEvent(pool, resolved, ev.data);
      ingested += 1;
      advanceTo = ev.cursor ?? advanceTo; // tiến tới row thành công này
    } catch {
      // ingestInboundEvent đã ghi connector_event 'rejected'. DỪNG: không nhảy qua row lỗi
      // (chống mất dữ liệu). Row lỗi + phần còn lại sẽ được pull lại lần sau.
      rejected += 1;
      stopped = true;
      break;
    }
  }
  // Cả lô thành công -> tiến tới cursor row cuối của adapter. Có lỗi -> chỉ tới row tốt cuối.
  if (!stopped) advanceTo = nextCursor ?? advanceTo;

  if (advanceTo !== null && advanceTo !== undefined) {
    await pool.query(
      `UPDATE cdp.connection SET pull_cursor=$2::jsonb, last_checked_at=now(), updated_at=now() WHERE id=$1`,
      [connectionId, JSON.stringify(advanceTo)],
    );
  } else {
    // Không tiến (row đầu đã lỗi / không có row) — vẫn ghi nhận thời điểm kiểm.
    await pool.query(`UPDATE cdp.connection SET last_checked_at=now() WHERE id=$1`, [connectionId]);
  }

  return { pulled: events.length, ingested, rejected, cursor: advanceTo ?? row.pull_cursor };
}
