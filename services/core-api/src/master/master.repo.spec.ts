import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import {
  listBrands,
  listStores,
  createStore,
  createCategory,
  createProduct,
  listProducts,
  mapSku,
  resolveProductMaster,
} from "./master.repo.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("master.repo — brand (reference data seed)", () => {
  it("seed sẵn 6 thương hiệu OCH", async () => {
    const brands = await listBrands(pool);
    const ids = brands.map((b) => b.brand_id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "givral",
        "kem_trang_tien",
        "fuji",
        "sunrise_nha_trang",
        "starcity_nha_trang",
        "dusit_hanoi",
      ]),
    );
    const givral = brands.find((b) => b.brand_id === "givral");
    expect(givral?.name).toBe("Givral");
    expect(givral?.brand_accent).toBe("#C8102E");
  });
});

describe("master.repo — store", () => {
  it("tạo store gắn brand rồi liệt kê theo brand", async () => {
    await createStore(pool, {
      store_id: "givral-q1",
      brand_id: "givral",
      name: "Givral Quận 1",
      region: "mien_nam",
      city: "HCM",
    });
    const stores = await listStores(pool, "givral");
    expect(stores.length).toBe(1);
    expect(stores[0]!.name).toBe("Givral Quận 1");
  });

  it("không tạo được store với brand không tồn tại (FK)", async () => {
    await expect(
      createStore(pool, {
        store_id: "x",
        brand_id: "khong_ton_tai",
        name: "X",
      }),
    ).rejects.toThrow();
  });
});

describe("master.repo — product + category + sku mapping", () => {
  it("tạo category + product rồi liệt kê", async () => {
    await createCategory(pool, { category_id: "banh_sinh_nhat", name: "Bánh sinh nhật" });
    await createProduct(pool, {
      product_master_id: "OCC-BSN-001",
      name: "Bánh kem dâu",
      category_id: "banh_sinh_nhat",
      unit: "cái",
    });
    const products = await listProducts(pool);
    expect(products.length).toBe(1);
    expect(products[0]!.category_id).toBe("banh_sinh_nhat");
  });

  it("map SKU brand -> product master rồi resolve", async () => {
    await createProduct(pool, { product_master_id: "OCC-BSN-001", name: "Bánh kem dâu" });
    await mapSku(pool, {
      brand_id: "givral",
      pos_sku: "GV-CAKE-01",
      product_master_id: "OCC-BSN-001",
    });
    const resolved = await resolveProductMaster(pool, "givral", "GV-CAKE-01");
    expect(resolved).toBe("OCC-BSN-001");
  });

  it("resolveProductMaster trả null khi SKU chưa map", async () => {
    const resolved = await resolveProductMaster(pool, "givral", "UNKNOWN");
    expect(resolved).toBeNull();
  });

  it("không map trùng (brand, pos_sku)", async () => {
    await createProduct(pool, { product_master_id: "OCC-A", name: "A" });
    await createProduct(pool, { product_master_id: "OCC-B", name: "B" });
    await mapSku(pool, { brand_id: "givral", pos_sku: "S1", product_master_id: "OCC-A" });
    await expect(
      mapSku(pool, { brand_id: "givral", pos_sku: "S1", product_master_id: "OCC-B" }),
    ).rejects.toThrow();
  });
});
