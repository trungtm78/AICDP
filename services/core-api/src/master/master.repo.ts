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
