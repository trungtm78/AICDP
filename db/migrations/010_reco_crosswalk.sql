-- Migration 010 — View enrich giao dịch: resolve items[].sku (pos_sku) -> product_master ->
-- category qua sku_mapping. Phục vụ AI: phân tích hành vi (category affinity), recommendation
-- cross-brand + market-basket, favorite_category. View (không bảng) -> không cần truncate.
-- Khi chưa có sku_mapping: product_master_id/category_id NULL -> reco rơi về collaborative thuần.

CREATE OR REPLACE VIEW cdp.v_purchase_enriched AS
SELECT
  ct.occ_id,
  ct.brand_id,
  ct.message_id,
  ct.occ_timestamp,
  (i->>'sku')                          AS pos_sku,
  (i->>'name')                         AS name,
  COALESCE((i->>'quantity')::numeric, 1)   AS quantity,
  COALESCE((i->>'unit_price')::numeric, 0) AS unit_price,
  sm.product_master_id,
  pm.category_id
FROM cdp.canonical_transaction ct
CROSS JOIN LATERAL jsonb_array_elements(ct.items) AS i
LEFT JOIN cdp.sku_mapping sm
  ON sm.brand_id = ct.brand_id AND sm.pos_sku = (i->>'sku')
LEFT JOIN cdp.product_master pm
  ON pm.product_master_id = sm.product_master_id
WHERE ct.occ_id IS NOT NULL AND (i->>'sku') IS NOT NULL;
