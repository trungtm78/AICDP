import type { Ch } from "./client.js";
import type { OrderCompletedEvent } from "../ingestion/ingestion.service.js";
import { insertTransaction, toChDateTime, type TransactionRow } from "./clickhouse.repo.js";

// Projection canonical_transaction (Postgres SoR) -> ClickHouse OLAP. Chạy SAU khi PG commit.
// Best-effort: lỗi CH KHÔNG làm gãy ingest (PG là nguồn sự thật; backfill lại được từ PG).

/** Map order event + kết quả ingest -> hàng OLAP. Pure (test được không cần CH). */
export function buildOrderRow(
  ev: OrderCompletedEvent,
  messageId: string,
  occId: string | null,
): TransactionRow {
  return {
    message_id: messageId,
    occ_id: occId ?? "",
    brand_id: ev.brand_id,
    store_id: ev.store_id,
    source: ev.source,
    pos_transaction_id: ev.properties.pos_transaction_id,
    currency: ev.properties.currency ?? "VND",
    total: ev.properties.total,
    occ_timestamp: toChDateTime(ev.occ_timestamp),
  };
}

/** Ghi projection best-effort (nuốt lỗi + log). Dùng fire-and-forget ở controller. */
export async function projectOrderBestEffort(
  ch: Ch,
  ev: OrderCompletedEvent,
  messageId: string,
  occId: string | null,
): Promise<void> {
  try {
    await insertTransaction(ch, buildOrderRow(ev, messageId, occId));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      "[ingest->CH] projection thất bại (PG là SoR, có thể backfill):",
      (err as Error).message,
    );
  }
}
