import { Controller, Post, Get, Body, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import {
  loyaltyEarnSchema,
  loyaltyReserveSchema,
  loyaltyReservationOpSchema,
  loyaltyBalanceQuerySchema,
} from "./schemas.js";
import { earn, reserve, capture, release, getBalance } from "../loyalty/loyalty.service.js";
import { Roles } from "./auth/roles.js";

/** Loyalty double-entry: earn + reserve/capture/release (theo reservationId) + balance. */
@Roles("csr", "analyst")
@Controller("v1/loyalty")
export class LoyaltyController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Roles("csr")
  @Post("earn")
  async earn(@Body() body: unknown) {
    const dto = validate(loyaltyEarnSchema, body, "loyalty_earn");
    return {
      data: await earn(this.pool, {
        occId: dto.occId,
        points: dto.points,
        idempotencyKey: dto.idempotencyKey,
        ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      }),
    };
  }

  @Roles("csr")
  @Post("reserve")
  async reserve(@Body() body: unknown) {
    const dto = validate(loyaltyReserveSchema, body, "loyalty_reserve");
    return { data: await reserve(this.pool, dto) };
  }

  @Roles("csr")
  @Post("capture")
  async capture(@Body() body: unknown) {
    const dto = validate(loyaltyReservationOpSchema, body, "loyalty_capture");
    return { data: await capture(this.pool, dto) };
  }

  @Roles("csr")
  @Post("release")
  async release(@Body() body: unknown) {
    const dto = validate(loyaltyReservationOpSchema, body, "loyalty_release");
    return { data: await release(this.pool, dto) };
  }

  @Get("balance")
  async balance(@Query() query: Record<string, string>) {
    const { occId } = validate(loyaltyBalanceQuerySchema, query, "loyalty_balance");
    return { data: await getBalance(this.pool, occId) };
  }
}
