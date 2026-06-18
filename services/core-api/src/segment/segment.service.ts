import type { Pool } from "pg";

// Segment builder v1 (read-only): chọn occId theo hành vi giao dịch (brand, tổng chi,
// số giao dịch). Kết quả feed vào activation (vốn gate consent). Mở rộng tiêu chí sau.

export interface SegmentCriteria {
  brandId?: string | undefined;
  minSpend?: number | undefined;
  minTransactions?: number | undefined;
}

export interface SegmentPreview {
  count: number;
  occIds: string[];
}

export async function previewSegment(
  pool: Pool,
  c: SegmentCriteria,
): Promise<SegmentPreview> {
  const where: string[] = ["occ_id IS NOT NULL"];
  const having: string[] = [];
  const params: unknown[] = [];

  if (c.brandId !== undefined) {
    params.push(c.brandId);
    where.push(`brand_id = $${params.length}`);
  }
  if (c.minSpend !== undefined) {
    params.push(c.minSpend);
    having.push(`COALESCE(sum(total),0) >= $${params.length}`);
  }
  if (c.minTransactions !== undefined) {
    params.push(c.minTransactions);
    having.push(`count(*) >= $${params.length}`);
  }

  const sql = `
    SELECT occ_id FROM cdp.canonical_transaction
    WHERE ${where.join(" AND ")}
    GROUP BY occ_id
    ${having.length > 0 ? "HAVING " + having.join(" AND ") : ""}
    ORDER BY occ_id`;

  const r = await pool.query<{ occ_id: string }>(sql, params);
  const occIds = r.rows.map((row) => row.occ_id);
  return { count: occIds.length, occIds };
}
