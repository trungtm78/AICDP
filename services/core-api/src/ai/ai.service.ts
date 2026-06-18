import type { Pool } from "pg";
import type { AiConfig } from "../ai-config/ai-config.service.js";

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

// ── Recommendation v2: Next-Best-Product cross-brand + market-basket + diversity + boost/bury ──
// Tính từ giao dịch THẬT qua view v_purchase_enriched (resolve cross-brand qua product_master).
// Explainable (source + reasons). Giữ recommendForCustomer (v1) làm fallback/back-compat.

export type RecoSource = "collaborative" | "cross_brand" | "market_basket" | "category";

export interface RecommendationV2 {
  itemKey: string;
  productMasterId: string | null;
  name: string | null;
  brandId: string | null;
  category: string | null;
  score: number;
  source: RecoSource;
  reasons: string[];
}

interface CandRow {
  item_key: string;
  name: string | null;
  pmid: string | null;
  brand_id: string | null;
  category_id: string | null;
  peer_score: number;
  basket_score: number;
}

export async function recommendV2(
  pool: Pool,
  occId: string,
  cfg: AiConfig["reco"],
): Promise<RecommendationV2[]> {
  // Hồ sơ "của tôi": brand + category đã mua (xác định cross-brand / category affinity).
  const meRes = await pool.query<{ brands: string[] | null; cats: string[] | null }>(
    `SELECT array_agg(DISTINCT brand_id) AS brands,
            array_agg(DISTINCT category_id) FILTER (WHERE category_id IS NOT NULL) AS cats
       FROM cdp.v_purchase_enriched WHERE occ_id=$1`,
    [occId],
  );
  const myBrands = new Set(meRes.rows[0]?.brands ?? []);
  const myCats = new Set(meRes.rows[0]?.cats ?? []);

  // Ứng viên: collaborative (peer co-purchase) + market-basket (co-occurrence cùng giỏ).
  const r = await pool.query<CandRow>(
    `WITH pe AS (
       SELECT occ_id, message_id, name, product_master_id, brand_id, category_id,
              COALESCE(product_master_id, 'sku:'||brand_id||':'||pos_sku) AS item_key
       FROM cdp.v_purchase_enriched
     ),
     mine AS (SELECT DISTINCT item_key FROM pe WHERE occ_id=$1),
     peers AS (SELECT DISTINCT e.occ_id FROM pe e JOIN mine m ON e.item_key=m.item_key WHERE e.occ_id<>$1),
     collab AS (
       SELECT e.item_key, count(DISTINCT e.occ_id)::int AS peer_score
       FROM pe e JOIN peers p ON e.occ_id=p.occ_id
       WHERE e.item_key NOT IN (SELECT item_key FROM mine)
       GROUP BY e.item_key
     ),
     basket AS (
       SELECT e2.item_key, count(*)::int AS basket_score
       FROM pe e1 JOIN pe e2 ON e1.message_id=e2.message_id AND e2.item_key<>e1.item_key
       WHERE e1.item_key IN (SELECT item_key FROM mine)
         AND e2.item_key NOT IN (SELECT item_key FROM mine)
       GROUP BY e2.item_key
     ),
     keys AS (SELECT item_key FROM collab UNION SELECT item_key FROM basket),
     meta AS (
       SELECT item_key, max(name) AS name, max(product_master_id) AS pmid,
              max(brand_id) AS brand_id, max(category_id) AS category_id
       FROM pe GROUP BY item_key
     )
     SELECT k.item_key, m.name, m.pmid, m.brand_id, m.category_id,
            COALESCE(c.peer_score,0) AS peer_score, COALESCE(b.basket_score,0) AS basket_score
     FROM keys k
     LEFT JOIN collab c USING (item_key)
     LEFT JOIN basket b USING (item_key)
     LEFT JOIN meta m USING (item_key)`,
    [occId],
  );

  const bury = new Set(cfg.bury);
  const boost = new Set(cfg.boost);
  const out: RecommendationV2[] = [];

  for (const row of r.rows) {
    const peer = Number(row.peer_score);
    const basket = cfg.enableMarketBasket ? Number(row.basket_score) : 0;
    const crossBrand = !!row.brand_id && !myBrands.has(row.brand_id);
    if (crossBrand && !cfg.enableCrossBrand) continue;
    if (bury.has(row.item_key) || (row.category_id && bury.has(row.category_id))) continue;

    const catMatch = !!row.category_id && myCats.has(row.category_id);
    let score = peer + basket;
    const reasons: string[] = [];
    if (peer > 0) reasons.push(`${peer} khách tương tự cũng mua`);
    if (basket > 0) reasons.push(`đồng xuất hiện ${basket} lần trong cùng giỏ (market-basket)`);
    if (catMatch) {
      score *= 1.25;
      reasons.push(`thuộc nhóm hàng khách hay mua (${row.category_id})`);
    }
    if (crossBrand) reasons.push(`gợi ý cross-brand (${row.brand_id})`);
    if (boost.has(row.item_key) || (row.category_id && boost.has(row.category_id))) {
      score *= 2;
      reasons.push("ưu tiên theo business rule (boost)");
    }
    const source: RecoSource =
      cfg.enableMarketBasket && basket > peer
        ? "market_basket"
        : crossBrand
          ? "cross_brand"
          : catMatch
            ? "category"
            : "collaborative";

    out.push({
      itemKey: row.item_key,
      productMasterId: row.pmid,
      name: row.name,
      brandId: row.brand_id,
      category: row.category_id,
      score: Math.round(score * 100) / 100,
      source,
      reasons,
    });
  }

  out.sort((a, b) => b.score - a.score || a.itemKey.localeCompare(b.itemKey));

  // Diversity: giới hạn số gợi ý mỗi category (diversityWeight cao -> đa dạng hơn).
  const capPerCat = Math.max(1, Math.ceil(cfg.topN * (1 - cfg.diversityWeight)));
  const perCat = new Map<string, number>();
  const diversified: RecommendationV2[] = [];
  for (const rec of out) {
    const cat = rec.category ?? "__none__";
    const used = perCat.get(cat) ?? 0;
    if (cat !== "__none__" && used >= capPerCat) continue;
    perCat.set(cat, used + 1);
    diversified.push(rec);
    if (diversified.length >= cfg.topN) break;
  }
  return diversified;
}
