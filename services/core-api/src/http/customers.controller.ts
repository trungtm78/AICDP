import { Controller, Get, Param, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { lookupQuerySchema, customerListQuerySchema } from "./schemas.js";
import { AppError } from "./errors.js";
import { getCustomer360, getCustomer360ByOccId, getTransactionDetail } from "../ingestion/ingestion.service.js";
import { listCustomers } from "../customers/customers.repo.js";
import { getCustomerAnalytics } from "../customers/customer-analytics.js";
import { Roles } from "./auth/roles.js";

/** Tra cứu Customer 360 theo một identifier (phone/email/...). */
@Roles("csr", "analyst", "marketer", "data_steward")
@Controller("v1/customers")
export class CustomersController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Customer Directory: danh sách khách hàng có phân trang + lọc (search/lifecycle). */
  @Get()
  async list(@Query() query: Record<string, string>) {
    const q = validate(customerListQuerySchema, query, "customer_list");
    const result = await listCustomers(this.pool, q);
    return { data: result.rows, meta: { total: result.total } };
  }

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

  /** Customer 360 theo occId (click từ danh sách khách). */
  @Get("by-id/:occId")
  async byId(@Param("occId") occId: string) {
    const c360 = await getCustomer360ByOccId(this.pool, occId);
    if (!c360) {
      throw new AppError({
        code: "CUSTOMER_NOT_FOUND",
        httpStatus: 404,
        message: "Không tìm thấy khách hàng với OCH ID đã cho.",
        why: "occId không tồn tại.",
        fix: "Kiểm tra lại OCH ID.",
        fieldPath: "occId",
        retryable: false,
      });
    }
    return { data: c360 };
  }

  /** Phân tích hành vi mua chuyên sâu theo occId (CLV, nhịp mua, ưa thích thương hiệu…). */
  @Get("by-id/:occId/analytics")
  async analytics(@Param("occId") occId: string) {
    return { data: await getCustomerAnalytics(this.pool, occId) };
  }

  /** Drill-down: chi tiết một giao dịch (món hàng, phương thức thanh toán…). */
  @Get("by-id/:occId/transactions/:messageId")
  async transactionDetail(@Param("occId") occId: string, @Param("messageId") messageId: string) {
    const detail = await getTransactionDetail(this.pool, occId, messageId);
    if (!detail) {
      throw new AppError({
        code: "CUSTOMER_NOT_FOUND",
        httpStatus: 404,
        message: "Không tìm thấy giao dịch.",
        why: "messageId không thuộc occId này (hoặc không tồn tại).",
        fix: "Kiểm tra lại messageId.",
        fieldPath: "messageId",
        retryable: false,
      });
    }
    return { data: detail };
  }
}
