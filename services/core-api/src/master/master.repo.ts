import type { Pool } from "pg";

export interface Brand {
  brand_id: string;
  name: string;
  industry: string | null;
  brand_accent: string | null;
  status: string;
}

export interface Store {
  store_id: string;
  brand_id: string;
  name: string;
  region: string | null;
  city: string | null;
  address: string | null;
  status: string;
}

export interface Product {
  product_master_id: string;
  name: string;
  category_id: string | null;
  unit: string | null;
  status: string;
}

export async function listBrands(pool: Pool): Promise<Brand[]> {
  const r = await pool.query<Brand>(
    `SELECT brand_id, name, industry, brand_accent, status
       FROM cdp.brand ORDER BY name`,
  );
  return r.rows;
}

export async function createStore(
  pool: Pool,
  s: {
    store_id: string;
    brand_id: string;
    name: string;
    region?: string | undefined;
    city?: string | undefined;
    address?: string | undefined;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.store (store_id, brand_id, name, region, city, address)
       VALUES ($1,$2,$3,$4,$5,$6)`,
    [s.store_id, s.brand_id, s.name, s.region ?? null, s.city ?? null, s.address ?? null],
  );
}

export async function listStores(pool: Pool, brandId?: string): Promise<Store[]> {
  if (brandId) {
    const r = await pool.query<Store>(
      `SELECT store_id, brand_id, name, region, city, address, status
         FROM cdp.store WHERE brand_id=$1 ORDER BY name`,
      [brandId],
    );
    return r.rows;
  }
  const r = await pool.query<Store>(
    `SELECT store_id, brand_id, name, region, city, address, status
       FROM cdp.store ORDER BY brand_id, name`,
  );
  return r.rows;
}

export async function createCategory(
  pool: Pool,
  c: { category_id: string; name: string; parent_id?: string | undefined },
): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.product_category (category_id, name, parent_id)
       VALUES ($1,$2,$3)`,
    [c.category_id, c.name, c.parent_id ?? null],
  );
}

export async function createProduct(
  pool: Pool,
  p: {
    product_master_id: string;
    name: string;
    category_id?: string | undefined;
    unit?: string | undefined;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.product_master (product_master_id, name, category_id, unit)
       VALUES ($1,$2,$3,$4)`,
    [p.product_master_id, p.name, p.category_id ?? null, p.unit ?? null],
  );
}

export async function listProducts(pool: Pool): Promise<Product[]> {
  const r = await pool.query<Product>(
    `SELECT product_master_id, name, category_id, unit, status
       FROM cdp.product_master ORDER BY name`,
  );
  return r.rows;
}

export async function mapSku(
  pool: Pool,
  m: { brand_id: string; pos_sku: string; product_master_id: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.sku_mapping (brand_id, pos_sku, product_master_id)
       VALUES ($1,$2,$3)`,
    [m.brand_id, m.pos_sku, m.product_master_id],
  );
}

// Build mệnh đề SET động AN TOÀN: chỉ duyệt các cột trong allowlist `cols`,
// chỉ set field !== undefined (tôn trọng exactOptionalPropertyTypes).
function buildUpdate(
  cols: readonly string[],
  patch: Record<string, unknown>,
): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const col of cols) {
    const val = patch[col];
    if (val !== undefined) {
      params.push(val);
      sets.push(`${col}=$${params.length}`);
    }
  }
  return { sets, params };
}

export async function updateStore(
  pool: Pool,
  storeId: string,
  patch: {
    name?: string | undefined;
    brand_id?: string | undefined;
    region?: string | undefined;
    city?: string | undefined;
    address?: string | undefined;
  },
): Promise<boolean> {
  const { sets, params } = buildUpdate(["name", "brand_id", "region", "city", "address"], patch);
  if (sets.length === 0) return false;
  params.push(storeId);
  const r = await pool.query(
    `UPDATE cdp.store SET ${sets.join(", ")}, updated_at=now() WHERE store_id=$${params.length}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteStore(pool: Pool, storeId: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM cdp.store WHERE store_id=$1`, [storeId]);
  return (r.rowCount ?? 0) > 0;
}

export async function updateProduct(
  pool: Pool,
  id: string,
  patch: {
    name?: string | undefined;
    category_id?: string | undefined;
    unit?: string | undefined;
  },
): Promise<boolean> {
  const { sets, params } = buildUpdate(["name", "category_id", "unit"], patch);
  if (sets.length === 0) return false;
  params.push(id);
  const r = await pool.query(
    `UPDATE cdp.product_master SET ${sets.join(", ")}, updated_at=now()
       WHERE product_master_id=$${params.length}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteProduct(pool: Pool, id: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM cdp.product_master WHERE product_master_id=$1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

export async function createBrand(
  pool: Pool,
  b: {
    brand_id: string;
    name: string;
    industry?: string | undefined;
    brand_accent?: string | undefined;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.brand (brand_id, name, industry, brand_accent) VALUES ($1,$2,$3,$4)`,
    [b.brand_id, b.name, b.industry ?? null, b.brand_accent ?? null],
  );
}

export async function updateBrand(
  pool: Pool,
  brandId: string,
  patch: {
    name?: string | undefined;
    industry?: string | undefined;
    brand_accent?: string | undefined;
  },
): Promise<boolean> {
  const { sets, params } = buildUpdate(["name", "industry", "brand_accent"], patch);
  if (sets.length === 0) return false;
  params.push(brandId);
  const r = await pool.query(
    `UPDATE cdp.brand SET ${sets.join(", ")}, updated_at=now() WHERE brand_id=$${params.length}`,
    params,
  );
  return (r.rowCount ?? 0) > 0;
}

export async function deleteBrand(pool: Pool, brandId: string): Promise<boolean> {
  const r = await pool.query(`DELETE FROM cdp.brand WHERE brand_id=$1`, [brandId]);
  return (r.rowCount ?? 0) > 0;
}

/** Resolve SKU nội bộ brand -> product_master_id chuẩn OCC, hoặc null nếu chưa map. */
export async function resolveProductMaster(
  pool: Pool,
  brandId: string,
  posSku: string,
): Promise<string | null> {
  const r = await pool.query<{ product_master_id: string }>(
    `SELECT product_master_id FROM cdp.sku_mapping
       WHERE brand_id=$1 AND pos_sku=$2`,
    [brandId, posSku],
  );
  return r.rows[0]?.product_master_id ?? null;
}
