import { Controller, Get, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { lookupQuerySchema } from "./schemas.js";
import { AppError } from "./errors.js";
import { getCustomer360 } from "../ingestion/ingestion.service.js";

/** Tra cứu Customer 360 theo một identifier (phone/email/...). */
@Controller("v1/customers")
export class CustomersController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("lookup")
  async lookup(@Query() query: Record<string, string>) {
    const q = validate(lookupQuerySchema, query, "customer_lookup");
    const opts = q.brand_id !== undefined ? { brandId: q.brand_id } : {};
    const c360 = await getCustomer360(this.pool, { type: q.type, value: q.value }, opts);
    if (!c360) {
      throw new AppError({
        code: "CUSTOMER_NOT_FOUND",
        httpStatus: 404,
        message: "Không tìm thấy khách hàng với identifier đã cho.",
        why: "Identifier chưa gắn với occ_id nào (hoặc giá trị không hợp lệ).",
        fix: "Kiểm tra lại type/value; KH có thể chưa từng phát sinh giao dịch.",
        fieldPath: "value",
        retryable: false,
      });
    }
    return { data: c360 };
  }
}
