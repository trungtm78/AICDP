import { Controller, Post, Get, Body, Param, Inject, HttpCode, NotFoundException } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { activationSchema } from "./schemas.js";
import { activate, getRun } from "../activation/activation.service.js";

/** Activation — kích hoạt audience tới destination, GATE bằng consent (deny-by-default). */
@Controller("v1/activation")
export class ActivationController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Post()
  @HttpCode(201)
  async run(@Body() body: unknown) {
    const dto = validate(activationSchema, body, "activation");
    return { data: await activate(this.pool, dto) };
  }

  @Get(":runId")
  async get(@Param("runId") runId: string) {
    const run = await getRun(this.pool, runId);
    if (!run) throw new NotFoundException("activation run không tồn tại");
    return { data: run };
  }
}
