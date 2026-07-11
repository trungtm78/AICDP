import type { Pool } from "pg";

// Tổng hợp số liệu THẬT đang chảy qua 1 connection (cho card/drawer UI): đếm event nhận theo
// loại + delivery gửi theo trạng thái. Nguồn: connector_event + connector_delivery (đã ghi ở
// logs.service). Trả về để FE hiển thị "1.240 giao dịch · 45 thanh toán · 532 tin gửi · 12 lỗi".

export interface DataSummary {
  events: {
    total: number;
    ingested: number;
    rejected: number;
    byType: Record<string, number>; // order_completed|identify|payment|...
  };
  deliveries: {
    total: number;
    sent: number;
    failed: number;
    skipped: number;
  };
}

export async function dataSummary(pool: Pool, connectionId: string): Promise<DataSummary> {
  const ev = await pool.query<{ event_type: string; status: string; n: string }>(
    `SELECT event_type, status, count(*)::text n FROM cdp.connector_event
      WHERE connection_id=$1 GROUP BY event_type, status`,
    [connectionId],
  );
  const dl = await pool.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text n FROM cdp.connector_delivery
      WHERE connection_id=$1 GROUP BY status`,
    [connectionId],
  );

  const events: DataSummary["events"] = { total: 0, ingested: 0, rejected: 0, byType: {} };
  for (const r of ev.rows) {
    const n = Number(r.n);
    events.total += n;
    if (r.status === "ingested") events.ingested += n;
    else if (r.status === "rejected") events.rejected += n;
    events.byType[r.event_type] = (events.byType[r.event_type] ?? 0) + n;
  }

  const deliveries: DataSummary["deliveries"] = { total: 0, sent: 0, failed: 0, skipped: 0 };
  for (const r of dl.rows) {
    const n = Number(r.n);
    deliveries.total += n;
    if (r.status === "sent") deliveries.sent += n;
    else if (r.status === "failed") deliveries.failed += n;
    else if (r.status === "skipped_no_contact") deliveries.skipped += n;
  }

  return { events, deliveries };
}
