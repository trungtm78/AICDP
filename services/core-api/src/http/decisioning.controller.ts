import { Controller, Get, Post, Delete, Body, Param, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { offerCreateSchema, experimentCreateSchema } from "./schemas.js";
import { listOffers, createOffer, deleteOffer, arbitrate } from "../decisioning/offer.service.js";
import { listExperiments, createExperiment, assignAll, computeUplift } from "../decisioning/experiment.service.js";
import { Roles } from "./auth/roles.js";

/** AI Decisioning — offer arbitration + Experimentation (A/B holdout + uplift). */
@Roles("marketer", "analyst")
@Controller("v1/decisioning")
export class DecisioningController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("offers")
  async offers() {
    return { data: await listOffers(this.pool) };
  }

  @Post("offers")
  @HttpCode(201)
  async addOffer(@Body() body: unknown) {
    const dto = validate(offerCreateSchema, body, "offer_create");
    return { data: await createOffer(this.pool, dto) };
  }

  @Delete("offers/:id")
  async removeOffer(@Param("id") id: string) {
    return { data: { deleted: await deleteOffer(this.pool, id) } };
  }

  /** Arbitration: chọn offer tốt nhất cho 1 khách (expectedValue = propensity × giá trị). */
  @Get("arbitrate/:occId")
  async arbitrate(@Param("occId") occId: string) {
    return { data: await arbitrate(this.pool, occId) };
  }

  @Get("experiments")
  async experiments() {
    return { data: await listExperiments(this.pool) };
  }

  @Post("experiments")
  @HttpCode(201)
  async addExperiment(@Body() body: unknown) {
    const dto = validate(experimentCreateSchema, body, "experiment_create");
    return { data: await createExperiment(this.pool, dto) };
  }

  /** Gán toàn bộ khách vào experiment (deterministic) — để có dữ liệu đo uplift. */
  @Post("experiments/:id/assign")
  @HttpCode(200)
  async assign(@Param("id") id: string) {
    return { data: { assigned: await assignAll(this.pool, id) } };
  }

  @Get("experiments/:id/uplift")
  async uplift(@Param("id") id: string) {
    return { data: await computeUplift(this.pool, id) };
  }
}
