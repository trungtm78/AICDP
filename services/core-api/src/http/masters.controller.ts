import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  Inject,
  HttpCode,
} from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { Roles } from "./auth/roles.js";
import { validate } from "./validate.js";
import { AppError } from "./errors.js";
import {
  storeCreateSchema,
  categoryCreateSchema,
  productCreateSchema,
  skuMappingSchema,
  storeUpdateSchema,
  productUpdateSchema,
  brandCreateSchema,
  brandUpdateSchema,
} from "./schemas.js";
import {
  listBrands,
  createStore,
  listStores,
  createCategory,
  createProduct,
  listProducts,
  mapSku,
  updateStore,
  deleteStore,
  updateProduct,
  deleteProduct,
  createBrand,
  updateBrand,
  deleteBrand,
  brandDetail,
} from "../master/master.repo.js";

// Nhận diện lỗi FK (foreign_key_violation) của Postgres.
function isFkViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === "23503"
  );
}

// Lỗi 409 khi xoá bản ghi còn được tham chiếu (giao dịch/mapping...).
function constraintError(): AppError {
  return new AppError({
    code: "CONSTRAINT_VIOLATION",
    httpStatus: 409,
    message:
      "Không thể xoá vì đang có dữ liệu liên quan (giao dịch/mapping). Hãy xoá/di chuyển dữ liệu liên quan trước.",
    why: "Bản ghi đang được tham chiếu bởi khóa ngoại ở bảng khác (Postgres 23503).",
    fix: "Xoá hoặc di chuyển dữ liệu liên quan trước, rồi thử lại.",
    retryable: false,
  });
}

// Lỗi 404 khi không tìm thấy bản ghi cần cập nhật/xoá.
function notFoundError(entity: string, id: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    httpStatus: 404,
    message: `Không tìm thấy ${entity} với id đã cho.`,
    why: `Không có bản ghi ${entity} khớp id=${id}.`,
    fix: "Kiểm tra lại id.",
    retryable: false,
  });
}

/** REST CRUD cho master data (brand/store/category/product/sku_mapping). */
// Đọc master: nhiều persona; ghi master: data_steward (admin luôn được).
@Roles("data_steward", "marketer", "csr", "analyst", "executive")
@Controller("v1")
export class MastersController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("brands")
  async getBrands() {
    return { data: await listBrands(this.pool) };
  }

  /** Drill-down: brand + cửa hàng kèm doanh thu/đơn. */
  @Get("brands/:id/detail")
  async getBrandDetail(@Param("id") id: string) {
    const detail = await brandDetail(this.pool, id);
    if (!detail) throw notFoundError("brand", id);
    return { data: detail };
  }

  @Get("stores")
  async getStores(@Query("brand_id") brandId?: string) {
    return { data: await listStores(this.pool, brandId) };
  }

  @Roles("data_steward")
  @Post("stores")
  @HttpCode(201)
  async postStore(@Body() body: unknown) {
    const dto = validate(storeCreateSchema, body, "store");
    await createStore(this.pool, dto);
    return { data: { store_id: dto.store_id } };
  }

  @Get("products")
  async getProducts() {
    return { data: await listProducts(this.pool) };
  }

  @Roles("data_steward")
  @Post("products")
  @HttpCode(201)
  async postProduct(@Body() body: unknown) {
    const dto = validate(productCreateSchema, body, "product_master");
    await createProduct(this.pool, dto);
    return { data: { product_master_id: dto.product_master_id } };
  }

  @Roles("data_steward")
  @Post("categories")
  @HttpCode(201)
  async postCategory(@Body() body: unknown) {
    const dto = validate(categoryCreateSchema, body, "product_category");
    await createCategory(this.pool, dto);
    return { data: { category_id: dto.category_id } };
  }

  @Roles("data_steward")
  @Post("sku-mappings")
  @HttpCode(201)
  async postSkuMapping(@Body() body: unknown) {
    const dto = validate(skuMappingSchema, body, "sku_mapping");
    await mapSku(this.pool, dto);
    return { data: { brand_id: dto.brand_id, pos_sku: dto.pos_sku } };
  }

  // ── CRUD Update/Delete ──

  // Bọc thao tác DELETE: FK 23503 -> 409, rowCount=0 -> 404.
  private async runDelete(
    fn: () => Promise<boolean>,
    entity: string,
    id: string,
  ): Promise<{ data: { deleted: true } }> {
    let ok: boolean;
    try {
      ok = await fn();
    } catch (e) {
      if (isFkViolation(e)) throw constraintError();
      throw e;
    }
    if (!ok) throw notFoundError(entity, id);
    return { data: { deleted: true } };
  }

  @Roles("data_steward")
  @Put("stores/:id")
  async putStore(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(storeUpdateSchema, body, "store_update");
    const ok = await updateStore(this.pool, id, dto);
    if (!ok) throw notFoundError("store", id);
    return { data: { store_id: id } };
  }

  @Roles("data_steward")
  @Delete("stores/:id")
  async deleteStoreRoute(@Param("id") id: string) {
    return this.runDelete(() => deleteStore(this.pool, id), "store", id);
  }

  @Roles("data_steward")
  @Put("products/:id")
  async putProduct(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(productUpdateSchema, body, "product_update");
    const ok = await updateProduct(this.pool, id, dto);
    if (!ok) throw notFoundError("product", id);
    return { data: { product_master_id: id } };
  }

  @Roles("data_steward")
  @Delete("products/:id")
  async deleteProductRoute(@Param("id") id: string) {
    return this.runDelete(() => deleteProduct(this.pool, id), "product", id);
  }

  @Roles("data_steward")
  @Post("brands")
  @HttpCode(201)
  async postBrand(@Body() body: unknown) {
    const dto = validate(brandCreateSchema, body, "brand");
    await createBrand(this.pool, dto);
    return { data: { brand_id: dto.brand_id } };
  }

  @Roles("data_steward")
  @Put("brands/:id")
  async putBrand(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(brandUpdateSchema, body, "brand_update");
    const ok = await updateBrand(this.pool, id, dto);
    if (!ok) throw notFoundError("brand", id);
    return { data: { brand_id: id } };
  }

  @Roles("data_steward")
  @Delete("brands/:id")
  async deleteBrandRoute(@Param("id") id: string) {
    return this.runDelete(() => deleteBrand(this.pool, id), "brand", id);
  }
}
