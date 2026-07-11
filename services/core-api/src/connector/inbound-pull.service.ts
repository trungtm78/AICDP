import type { Pool } from "pg";
import { AppError } from "../http/errors.js";
import { decryptConfig } from "./secrets.js";
import { getInboundPull } from "./adapters/registry.js";
import { ingestInboundEvent } from "./inbound-ingest.service.js";
import type { ResolvedInbound } from "./inbound.service.js";

// Runner reverse-ETL: đọc cursor -> gọi adapter.pull (SELECT-only) -> nạp từng event qua
// ingestInboundEvent (validate + ghi connector_event) -> tiến pull_cursor. Admin/data_steward
// kích hoạt (POST /connections/:id/pull). brand_id lấy từ connection config (chống spoof).

export interface PullSummary {
  pulled: number;
  ingested: number;
  rejected: number;
  cursor: Record<string, unknown> | null;
}

export async function pullConnection(pool: Pool, connectionId: string): Promise<PullSummary> {
  const r = await pool.query<{
    direction: string; connector_key: string;
    config: Record<string, unknown>; pull_cursor: Record<string, unknown> | null;
  }>(
    `SELECT direction, connector_key, config, pull_cursor FROM cdp.connection WHERE id=$1`,
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
  for (const ev of events) {
    try {
      await ingestInboundEvent(pool, resolved, ev.data);
      ingested += 1;
    } catch {
      // ingestInboundEvent đã ghi connector_event 'rejected'; chỉ đếm, không dừng cả lô.
      rejected += 1;
    }
  }

  // Tiến cursor (chỉ khi có tiến triển: adapter trả cursor cũ nếu 0 dòng -> ghi lại vô hại).
  await pool.query(
    `UPDATE cdp.connection SET pull_cursor=$2::jsonb, last_checked_at=now(), updated_at=now() WHERE id=$1`,
    [connectionId, JSON.stringify(nextCursor)],
  );

  return { pulled: events.length, ingested, rejected, cursor: nextCursor };
}
