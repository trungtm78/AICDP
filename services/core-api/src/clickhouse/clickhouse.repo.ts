import type { Ch } from "./client.js";

// Repo OLAP: ghi projection giao dịch + truy vấn tổng hợp KPI realtime từ ClickHouse.
// Dedup bằng FINAL (ReplacingMergeTree theo message_id) để re-project/backfill an toàn.

export interface TransactionRow {
  message_id: string;
  occ_id: string;
  brand_id: string;
  store_id: string;
  source: string;
  pos_transaction_id: string;
  currency: string;
  total: number;
  /** Định dạng CH 'YYYY-MM-DD HH:MM:SS.sss' (UTC) — dùng toChDateTime() để chuyển từ ISO. */
  occ_timestamp: string;
}

export interface TxAggregate {
  transactions: number;
  revenue: number;
}

export interface BrandRevenue {
  brandId: string;
  revenue: number;
  transactions: number;
}

/** Chuyển ISO 8601 -> 'YYYY-MM-DD HH:MM:SS.sss' (UTC) mà ClickHouse parse chắc chắn. */
export function toChDateTime(iso: string): string {
  return new Date(iso).toISOString().replace("T", " ").replace("Z", "");
}

/** Ghi 1 giao dịch vào CH (escaping an toàn qua client). ingested_at để DEFAULT now64. */
export async function insertTransaction(ch: Ch, row: TransactionRow): Promise<void> {
  await ch.insert({ table: "transactions", values: [row], format: "JSONEachRow" });
}

/** Tổng số giao dịch + doanh thu (dedup theo message_id bằng FINAL). */
export async function getTxAggregate(ch: Ch): Promise<TxAggregate> {
  const rs = await ch.query({
    query:
      "SELECT count() AS transactions, sum(total) AS revenue FROM transactions FINAL",
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{ transactions: string; revenue: number | null }>;
  const r = rows[0];
  return {
    transactions: Number(r?.transactions ?? 0),
    revenue: Number(r?.revenue ?? 0),
  };
}

/** Doanh thu theo thương hiệu (sức mạnh OLAP — group-by realtime). */
export async function getRevenueByBrand(ch: Ch): Promise<BrandRevenue[]> {
  const rs = await ch.query({
    query: `SELECT brand_id, sum(total) AS revenue, count() AS transactions
            FROM transactions FINAL
            GROUP BY brand_id
            ORDER BY revenue DESC`,
    format: "JSONEachRow",
  });
  const rows = (await rs.json()) as Array<{
    brand_id: string;
    revenue: number | null;
    transactions: string;
  }>;
  return rows.map((r) => ({
    brandId: r.brand_id,
    revenue: Number(r.revenue ?? 0),
    transactions: Number(r.transactions),
  }));
}
