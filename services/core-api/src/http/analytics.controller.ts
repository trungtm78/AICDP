import { Controller, Get, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { getOverview } from "../analytics/analytics.service.js";

/** Analytics — KPI tổng hợp cho Control Tower. */
@Controller("v1/analytics")
export class AnalyticsController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("overview")
  async overview() {
    return { data: await getOverview(this.pool) };
  }
}
