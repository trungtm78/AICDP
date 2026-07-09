import { Controller, Get, Post, Param, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { PREDICTION_PROVIDER, type IPredictionProvider } from "../prediction/prediction.provider.js";
import {
  getPrediction, listPredictions, getDistribution, getModelCards, recomputeAll,
} from "../prediction/prediction.service.js";
import { Roles } from "./auth/roles.js";

/** Predictive Studio — điểm dự đoán ML (ai-service) + fallback heuristic. */
@Roles("marketer", "analyst", "executive", "data_steward")
@Controller("v1/predictions")
export class PredictionController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(PREDICTION_PROVIDER) private readonly provider: IPredictionProvider,
  ) {}

  @Get("customers")
  async list(@Query() q: Record<string, string>) {
    const res = await listPredictions(this.pool, {
      ...(q.model ? { model: q.model } : {}),
      ...(q.limit ? { limit: Number(q.limit) } : {}),
      ...(q.offset ? { offset: Number(q.offset) } : {}),
    });
    return { data: res.rows, meta: { total: res.total } };
  }

  @Get("customers/:occId")
  async one(@Param("occId") occId: string) {
    return { data: await getPrediction(this.pool, this.provider, occId) };
  }

  @Get("model-cards")
  async cards() {
    return { data: await getModelCards(this.pool) };
  }

  @Get("distribution")
  async distribution(@Query("metric") metric = "churn") {
    return { data: await getDistribution(this.pool, metric) };
  }

  @Get("health")
  async health() {
    return { data: { aiService: await this.provider.health() } };
  }

  @Roles("admin", "data_steward")
  @Post("recompute")
  async recompute() {
    return { data: await recomputeAll(this.pool, this.provider) };
  }
}
