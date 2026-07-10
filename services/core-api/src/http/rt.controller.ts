import { Controller, Get, Post, Param, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { PG_POOL } from "./pg.provider.js";
import { REDIS } from "./redis.provider.js";
import { getProfile, getReco, warmAll, redisStatus } from "../personalization/rt.service.js";
import { Roles } from "./auth/roles.js";

/** Real-time Personalization API (độ trễ thấp): profile + reco cache-aside Redis, fallback PG.
 *  Dành cho web/app storefront — xác thực bằng API key (hoặc JWT). */
@Roles("marketer", "analyst", "connector", "data_steward")
@Controller("v1/rt")
export class RtController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get("profile/:occId")
  async profile(@Param("occId") occId: string) {
    const t0 = performance.now();
    const r = await getProfile(this.pool, this.redis, occId);
    return { data: r.data, meta: { cacheHit: r.cacheHit, latencyMs: Math.round((performance.now() - t0) * 100) / 100 } };
  }

  @Get("reco/:occId")
  async reco(@Param("occId") occId: string) {
    const t0 = performance.now();
    const r = await getReco(this.pool, this.redis, occId);
    return { data: r.data, meta: { cacheHit: r.cacheHit, latencyMs: Math.round((performance.now() - t0) * 100) / 100 } };
  }

  @Get("status")
  async status() {
    return { data: await redisStatus(this.redis) };
  }

  @Roles("data_steward", "marketer")
  @Post("warm")
  async warm() {
    return { data: await warmAll(this.pool, this.redis) };
  }
}
