import { Controller, Get, Query, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { aiRecQuerySchema } from "./schemas.js";
import { recommendForCustomer } from "../ai/ai.service.js";
import { Roles } from "./auth/roles.js";

/** AI cross-sell — gợi ý next-best-product (collaborative). RBAC: marketer/analyst. */
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
}
