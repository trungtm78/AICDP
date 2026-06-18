import type { Pool } from "pg";

// Segment builder (read-only): chọn occId theo hành vi giao dịch + AI feature (lifecycle,
// recency, loyalty, category) + consent. Kết quả feed vào activation (vốn gate consent).
// Tiêu chí feature dùng customer_feature (cần recompute trước). Mọi field optional -> tương
// thích ngược (chữ ký cũ brand/minSpend/minTransactions vẫn chạy nguyên).

export interface SegmentCriteria {
  brandId?: string | undefined;
  minSpend?: number | undefined;
  minTransactions?: number | undefined;
  maxRecencyDays?: number | undefined;
  lifecycleStage?: string | undefined;
  loyaltyMin?: number | undefined;
  categoryAffinity?: string | undefined;
  consentPurpose?: string | undefined;
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

  // Điều kiện trên customer_feature (chỉ JOIN khi có tiêu chí feature).
  const featureConds: string[] = [];
  if (c.lifecycleStage !== undefined) {
    params.push(c.lifecycleStage);
    featureConds.push(`cf.lifecycle_stage = $${params.length}`);
  }
  if (c.maxRecencyDays !== undefined) {
    params.push(c.maxRecencyDays);
    featureConds.push(`cf.recency_days IS NOT NULL AND cf.recency_days <= $${params.length}`);
  }
  if (c.loyaltyMin !== undefined) {
    params.push(c.loyaltyMin);
    featureConds.push(`cf.loyalty_available >= $${params.length}`);
  }
  if (c.categoryAffinity !== undefined) {
    params.push(c.categoryAffinity);
    featureConds.push(`cf.favorite_category = $${params.length}`);
  }

  const outerConds: string[] = [];
  if (c.consentPurpose !== undefined) {
    params.push(c.consentPurpose);
    // latest-wins: bản ghi consent mới nhất theo purpose = granted.
    outerConds.push(
      `EXISTS (SELECT 1 FROM (
         SELECT DISTINCT ON (purpose) status FROM cdp.consent_record
         WHERE occ_id=b.occ_id AND purpose=$${params.length}
         ORDER BY purpose, recorded_at DESC, id DESC
       ) s WHERE s.status='granted')`,
    );
  }

  const base = `
    SELECT occ_id FROM cdp.canonical_transaction
    WHERE ${where.join(" AND ")}
    GROUP BY occ_id
    ${having.length > 0 ? "HAVING " + having.join(" AND ") : ""}`;

  const join = featureConds.length > 0 ? "JOIN cdp.customer_feature cf ON cf.occ_id = b.occ_id" : "";
  const allConds = [...featureConds, ...outerConds];
  const sql = `
    WITH base AS (${base})
    SELECT b.occ_id FROM base b
    ${join}
    ${allConds.length > 0 ? "WHERE " + allConds.join(" AND ") : ""}
    ORDER BY b.occ_id`;

  const r = await pool.query<{ occ_id: string }>(sql, params);
  const occIds = r.rows.map((row) => row.occ_id);
  return { count: occIds.length, occIds };
}
