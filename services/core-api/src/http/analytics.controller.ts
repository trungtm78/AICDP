import { Controller, Get, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { CH_CLIENT } from "./ch.provider.js";
import type { Ch } from "../clickhouse/client.js";
import { getOverview, getBrandRevenue } from "../analytics/analytics.service.js";
import { Roles } from "./auth/roles.js";

/** Analytics — KPI tổng hợp cho Control Tower (transactions/revenue từ ClickHouse OLAP). */
@Roles("executive", "analyst", "marketer")
@Controller("v1/analytics")
export class AnalyticsController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CH_CLIENT) private readonly ch: Ch,
  ) {}

  @Get("overview")
  async overview() {
    return { data: await getOverview(this.pool, this.ch) };
  }

  @Get("revenue-by-brand")
  async revenueByBrand() {
    return { data: await getBrandRevenue(this.ch) };
  }
}
