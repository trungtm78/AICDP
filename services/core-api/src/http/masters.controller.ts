import { Controller, Get, Post, Body, Query, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { Roles } from "./auth/roles.js";
import { validate } from "./validate.js";
import {
  storeCreateSchema,
  categoryCreateSchema,
  productCreateSchema,
  skuMappingSchema,
} from "./schemas.js";
import {
  listBrands,
  createStore,
  listStores,
  createCategory,
  createProduct,
  listProducts,
  mapSku,
} from "../master/master.repo.js";

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
}
