import { Controller, Post, Get, Body, Param, Inject, HttpCode, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { activationSchema, activationDeliverSchema } from "./schemas.js";
import { activate, getRun, listRuns, listRunMembers } from "../activation/activation.service.js";
import { deliverActivationRun } from "../connector/outbound.service.js";
import { Roles } from "./auth/roles.js";

/** Activation — kích hoạt audience tới destination, GATE bằng consent (deny-by-default). */
@Roles("marketer")
@Controller("v1/activation")
export class ActivationController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Post()
  @HttpCode(201)
  async run(@Body() body: unknown) {
    const dto = validate(activationSchema, body, "activation");
    return { data: await activate(this.pool, dto) };
  }

  @Get()
  async list() {
    return { data: await listRuns(this.pool) };
  }

  @Get(":runId")
  async get(@Param("runId") runId: string) {
    const run = await getRun(this.pool, runId);
    if (!run) throw new NotFoundException("activation run không tồn tại");
    return { data: run };
  }

  /** Drill-down: khách của một lần kích hoạt (allowed / suppressed). */
  @Get(":runId/members")
  async members(@Param("runId") runId: string) {
    return { data: await listRunMembers(this.pool, runId) };
  }

  /** Giao hàng THẬT audience đã gate-consent tới destination connection (post-commit side-effect). */
  @Post(":runId/deliver")
  @HttpCode(200)
  async deliver(@Param("runId") runId: string, @Body() body: unknown) {
    const dto = validate(activationDeliverSchema, body, "activation_deliver");
    return { data: await deliverActivationRun(this.pool, runId, dto.connectionId) };
  }
}
