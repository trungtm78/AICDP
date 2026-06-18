import type { Pool } from "pg";

// AI cross-sell v1: item-based collaborative filtering ("khách giống bạn cũng mua").
// Tính từ giao dịch THẬT (canonical_transaction.items jsonb). Loại sản phẩm đã mua.
// GĐ sau: nâng lên model (co-visitation matrix offline, embeddings) — interface giữ nguyên.

export interface Recommendation {
  sku: string;
  name: string | null;
  /** Số khách "peer" (cùng mua sp khách đã mua) cũng mua sp này — điểm xếp hạng. */
  score: number;
}

export async function recommendForCustomer(
  pool: Pool,
  occId: string,
  limit = 10,
): Promise<Recommendation[]> {
  const r = await pool.query<{ sku: string; name: string | null; score: string }>(
    `
    WITH purchases AS (
      SELECT ct.occ_id, (i->>'sku') AS sku, (i->>'name') AS name
      FROM cdp.canonical_transaction ct,
           LATERAL jsonb_array_elements(ct.items) AS i
      WHERE ct.occ_id IS NOT NULL AND (i->>'sku') IS NOT NULL
    ),
    mine AS (SELECT DISTINCT sku FROM purchases WHERE occ_id = $1),
    peers AS (
      SELECT DISTINCT p.occ_id
      FROM purchases p JOIN mine m ON p.sku = m.sku
      WHERE p.occ_id <> $1
    )
    SELECT p.sku, max(p.name) AS name, count(DISTINCT p.occ_id)::int AS score
    FROM purchases p JOIN peers pe ON p.occ_id = pe.occ_id
    WHERE p.sku NOT IN (SELECT sku FROM mine)
    GROUP BY p.sku
    ORDER BY score DESC, p.sku
    LIMIT $2`,
    [occId, limit],
  );
  return r.rows.map((row) => ({ sku: row.sku, name: row.name, score: Number(row.score) }));
}
