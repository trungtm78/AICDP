import { Controller, Get, Post, Param, Query, Req, Inject } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { CH_CLIENT } from "./ch.provider.js";
import type { Ch } from "../clickhouse/client.js";
import { getOverview, getBrandRevenue, getInsights } from "../analytics/analytics.service.js";
import { detectAnomalies, listAlerts, getMetricSeries, acknowledgeAlert } from "../analytics/anomaly.service.js";
import { generateNarrative } from "../analytics/narrative.service.js";
import { forecastRevenue } from "../forecast/forecast.service.js";
import { validate } from "./validate.js";
import { forecastQuerySchema } from "./schemas.js";
import { Roles, type AuthContext } from "./auth/roles.js";

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

  /** Phân tích chuyên sâu (PG): vòng đời, doanh thu brand, nhóm hàng, synergy cross-brand. */
  @Get("insights")
  async insights() {
    return { data: await getInsights(this.pool) };
  }

  /** Phát hiện bất thường (z-score) trên chuỗi doanh thu/đơn/khách mới. */
  @Get("anomalies")
  async anomalies() {
    return { data: await detectAnomalies(this.pool) };
  }

  /** Danh sách cảnh báo đã lưu (trang Alerts). */
  @Get("alerts")
  async alerts() {
    return { data: await listAlerts(this.pool) };
  }

  /** Chuỗi thời gian 1 metric + điểm bất thường (chart AnomalyLine). */
  @Get("series")
  async series(@Query("metric") metric = "revenue_weekly") {
    return { data: await getMetricSeries(this.pool, metric) };
  }

  @Post("alerts/:id/ack")
  async ack(@Param("id") id: string) {
    return { data: { ok: await acknowledgeAlert(this.pool, id) } };
  }

  /** Auto-narrative (LLM nếu cấu hình, else template) diễn giải tình hình. */
  @Get("narrative")
  async narrative(@Req() req: Request) {
    const pid = (req as Request & { auth?: AuthContext }).auth?.principalId;
    return { data: await generateNarrative(this.pool, pid) };
  }
}
