import { Controller, Get, Post, Body, Query, HttpCode, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { aiRecQuerySchema, nbaSchema } from "./schemas.js";
import { recommendForCustomer, recommendV2 } from "../ai/ai.service.js";
import { decideNBA } from "../decisioning/decisioning.service.js";
import { getConfig } from "../ai-config/ai-config.service.js";
import { Roles } from "./auth/roles.js";

/** AI cross-sell — gợi ý next-best-product. RBAC: marketer/analyst. */
@Roles("marketer", "analyst")
@Controller("v1/ai")
export class AiController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("recommendations")
  async recommendations(@Query() query: Record<string, string>) {
    const q = validate(aiRecQuerySchema, query, "ai_recommendations");
    const recs = await recommendForCustomer(this.pool, q.occId, q.limit ?? 10);
    return { data: { occId: q.occId, recommendations: recs } };
  }

  /** v2: cross-brand NBA + market-basket + diversity + boost/bury (tham số từ ai_config). */
  @Get("recommendations/v2")
  async recommendationsV2(@Query() query: Record<string, string>) {
    const q = validate(aiRecQuerySchema, query, "ai_recommendations");
    const cfg = await getConfig(this.pool);
    const recs = await recommendV2(this.pool, q.occId, cfg.reco);
    return { data: { occId: q.occId, recommendations: recs } };
  }

  /** Next-Best-Action: rule + lifecycle + consent gate (explainable). */
  @Post("nba")
  @HttpCode(200)
  async nba(@Body() body: unknown) {
    const q = validate(nbaSchema, body, "ai_nba");
    const cfg = await getConfig(this.pool);
    return { data: await decideNBA(this.pool, q.occId, cfg) };
  }
}
