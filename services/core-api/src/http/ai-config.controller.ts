import { Controller, Get, Post, Body, Req, HttpCode, Inject } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { aiConfigUpdateSchema } from "./schemas.js";
import { getConfig, setConfig, listAudit } from "../ai-config/ai-config.service.js";
import { Roles } from "./auth/roles.js";
import type { AuthContext } from "./auth/roles.js";

/** AI Config & Governance — chỉ admin. Đổi tham số AI (RBAC server-side) + audit bất biến. */
@Roles("admin")
@Controller("v1/ai/config")
export class AiConfigController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async get() {
    return { data: await getConfig(this.pool) };
  }

  @Post()
  @HttpCode(200)
  async update(@Body() body: unknown, @Req() req: Request) {
    const dto = validate(aiConfigUpdateSchema, body, "ai_config");
    const auth = (req as Request & { auth?: AuthContext }).auth;
    const changedBy = auth?.principalId ?? "unknown";
    const data = await setConfig(this.pool, dto.section, dto.value, changedBy);
    return { data };
  }

  @Get("audit")
  async audit() {
    return { data: await listAudit(this.pool) };
  }
}
