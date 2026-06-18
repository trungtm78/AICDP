import { Controller, Get, Post, Body, Param, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { journeyCreateSchema } from "./schemas.js";
import {
  createJourney,
  listJourneys,
  runJourney,
  type CreateJourneyArgs,
} from "../journey/journey.service.js";
import { Roles } from "./auth/roles.js";

/** Journeys — orchestration (segment -> action). RBAC: marketer. */
@Roles("marketer")
@Controller("v1/journeys")
export class JourneyController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async list() {
    return { data: await listJourneys(this.pool) };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const dto = validate(journeyCreateSchema, body, "journey_create");
    return { data: await createJourney(this.pool, dto as CreateJourneyArgs) };
  }

  @Post(":id/run")
  @HttpCode(200)
  async run(@Param("id") id: string) {
    return { data: await runJourney(this.pool, id) };
  }
}
