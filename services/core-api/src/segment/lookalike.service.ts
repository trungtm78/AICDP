import type { Pool } from "pg";

// Lookalike (audience expansion): tìm khách TƯƠNG ĐỒNG một tập seed theo vector đặc trưng
// RFM+hành vi (chuẩn hoá z-score), khoảng cách COSINE tới centroid seed. Demo-grade: tương
// đồng theo hành vi, KHÔNG phải mô hình học sâu. Loại seed khỏi kết quả. Đọc customer_feature.

const FEATURES = ["recency_days", "frequency", "monetary", "avg_basket", "distinct_brands", "distinct_categories", "loyalty_available"] as const;

interface FeatureRow {
  occ_id: string;
  recency_days: number | null;
  frequency: number;
  monetary: number;
  avg_basket: number;
  distinct_brands: number;
  distinct_categories: number;
  loyalty_available: number;
}

export interface LookalikeResult {
  occId: string;
  fullName: string | null;
  similarity: number;
}

function vec(r: FeatureRow): number[] {
  // pg trả bigint dạng string -> BẮT BUỘC ép Number (tránh nối chuỗi khi cộng dồn).
  return [
    Number(r.recency_days ?? 9999), Number(r.frequency), Number(r.monetary), Number(r.avg_basket),
    Number(r.distinct_brands), Number(r.distinct_categories), Number(r.loyalty_available),
  ];
}

/** Tìm top-N khách tương đồng seed (cosine trên vector RFM chuẩn hoá z-score). */
export async function lookalike(pool: Pool, seedOccIds: string[], limit = 50): Promise<LookalikeResult[]> {
  if (seedOccIds.length === 0) return [];
  const r = await pool.query<FeatureRow & { full_name: string | null }>(
    `SELECT cf.occ_id::text, cf.recency_days, cf.frequency, cf.monetary, cf.avg_basket,
            cf.distinct_brands, cf.distinct_categories, cf.loyalty_available, p.full_name
       FROM cdp.customer_feature cf LEFT JOIN cdp.profile p ON p.occ_id = cf.occ_id`,
  );
  if (r.rows.length === 0) return [];

  const rows = r.rows;
  const raw = rows.map(vec);
  const dim = FEATURES.length;
  // z-score chuẩn hoá từng chiều
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const v of raw) for (let i = 0; i < dim; i++) mean[i] += v[i]!;
  for (let i = 0; i < dim; i++) mean[i] /= raw.length;
  for (const v of raw) for (let i = 0; i < dim; i++) std[i] += (v[i]! - mean[i]) ** 2;
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i] / raw.length) || 1;
  const norm = raw.map((v) => v.map((x, i) => (x - mean[i]) / std[i]));

  const seedSet = new Set(seedOccIds);
  const seedIdx = rows.map((row, i) => (seedSet.has(row.occ_id) ? i : -1)).filter((i) => i >= 0);
  if (seedIdx.length === 0) return [];
  const centroid = new Array(dim).fill(0);
  for (const i of seedIdx) for (let d = 0; d < dim; d++) centroid[d] += norm[i]![d]!;
  for (let d = 0; d < dim; d++) centroid[d] /= seedIdx.length;

  const cNorm = Math.sqrt(centroid.reduce((s, x) => s + x * x, 0)) || 1;
  const scored: LookalikeResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (seedSet.has(rows[i]!.occ_id)) continue;
    const v = norm[i]!;
    const dot = v.reduce((s, x, d) => s + x * centroid[d], 0);
    const vNorm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    const sim = dot / (vNorm * cNorm);
    scored.push({ occId: rows[i]!.occ_id, fullName: rows[i]!.full_name, similarity: Math.round(sim * 1e4) / 1e4 });
  }
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, Math.min(limit, 200));
}
