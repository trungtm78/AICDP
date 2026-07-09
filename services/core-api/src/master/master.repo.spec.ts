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
  updateStore,
  deleteStore,
  updateProduct,
  deleteProduct,
  createBrand,
  updateBrand,
  deleteBrand,
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

describe("master.repo — update/delete store", () => {
  it("cập nhật store rồi liệt kê thấy giá trị mới", async () => {
    await createStore(pool, { store_id: "s1", brand_id: "givral", name: "Cũ", city: "HCM" });
    const ok = await updateStore(pool, "s1", { name: "Mới", city: "Hà Nội" });
    expect(ok).toBe(true);
    const stores = await listStores(pool, "givral");
    expect(stores[0]!.name).toBe("Mới");
    expect(stores[0]!.city).toBe("Hà Nội");
  });

  it("cập nhật store không tồn tại trả false", async () => {
    expect(await updateStore(pool, "khong_co", { name: "X" })).toBe(false);
  });

  it("xoá store trả true rồi danh sách rỗng", async () => {
    await createStore(pool, { store_id: "s2", brand_id: "givral", name: "S2" });
    expect(await deleteStore(pool, "s2")).toBe(true);
    expect((await listStores(pool, "givral")).length).toBe(0);
  });

  it("xoá store không tồn tại trả false", async () => {
    expect(await deleteStore(pool, "khong_co")).toBe(false);
  });
});

describe("master.repo — update/delete product", () => {
  it("cập nhật product rồi liệt kê thấy giá trị mới", async () => {
    await createProduct(pool, { product_master_id: "P1", name: "Cũ", unit: "cái" });
    const ok = await updateProduct(pool, "P1", { name: "Mới", unit: "hộp" });
    expect(ok).toBe(true);
    const products = await listProducts(pool);
    expect(products[0]!.name).toBe("Mới");
    expect(products[0]!.unit).toBe("hộp");
  });

  it("xoá product trả true; xoá lần nữa trả false", async () => {
    await createProduct(pool, { product_master_id: "P2", name: "P2" });
    expect(await deleteProduct(pool, "P2")).toBe(true);
    expect(await deleteProduct(pool, "P2")).toBe(false);
  });
});

describe("master.repo — brand CRUD", () => {
  it("tạo + cập nhật + xoá brand mới", async () => {
    await createBrand(pool, { brand_id: "test_brand", name: "Test", industry: "bakery" });
    let brands = await listBrands(pool);
    expect(brands.find((b) => b.brand_id === "test_brand")?.name).toBe("Test");

    const ok = await updateBrand(pool, "test_brand", { name: "Đổi tên", brand_accent: "#123456" });
    expect(ok).toBe(true);
    brands = await listBrands(pool);
    const tb = brands.find((b) => b.brand_id === "test_brand");
    expect(tb?.name).toBe("Đổi tên");
    expect(tb?.brand_accent).toBe("#123456");

    expect(await deleteBrand(pool, "test_brand")).toBe(true);
    expect((await listBrands(pool)).find((b) => b.brand_id === "test_brand")).toBeUndefined();
  });

  it("xoá brand đang có store -> vi phạm FK (pg 23503)", async () => {
    await createStore(pool, { store_id: "gs1", brand_id: "givral", name: "GS1" });
    await expect(deleteBrand(pool, "givral")).rejects.toMatchObject({ code: "23503" });
  });
});
