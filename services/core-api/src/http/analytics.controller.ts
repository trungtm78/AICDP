import { Controller, Get, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { CH_CLIENT } from "./ch.provider.js";
import type { Ch } from "../clickhouse/client.js";
import { getOverview, getBrandRevenue } from "../analytics/analytics.service.js";
import { forecastRevenue } from "../forecast/forecast.service.js";
import { validate } from "./validate.js";
import { forecastQuerySchema } from "./schemas.js";
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

  /** Dự báo doanh số/nhu cầu (heuristic) theo brand/store. */
  @Get("forecast")
  async forecast(@Query() query: Record<string, string>) {
    const q = validate(forecastQuerySchema, query, "analytics_forecast");
    return { data: await forecastRevenue(this.pool, q) };
  }
}
