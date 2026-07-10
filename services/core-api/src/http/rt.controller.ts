import { Controller, Get, Post, Param, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import type { Redis } from "ioredis";
import { PG_POOL } from "./pg.provider.js";
import { REDIS } from "./redis.provider.js";
import { getProfile, getReco, warmAll, redisStatus } from "../personalization/rt.service.js";
import { Roles } from "./auth/roles.js";

/** Real-time Personalization API (độ trễ thấp): profile + reco cache-aside Redis, fallback PG.
 *  profile trả PII (họ tên) → CHỈ role nội bộ; reco phi-PII → cho cả `connector` (storefront). */
@Roles("marketer", "analyst", "data_steward")
@Controller("v1/rt")
export class RtController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Trả PII (fullName) → KHÔNG cho `connector` (chống liệt kê occId lấy tên khách hàng loạt). */
  @Get("profile/:occId")
  async profile(@Param("occId") occId: string) {
    const t0 = performance.now();
    const r = await getProfile(this.pool, this.redis, occId);
    return { data: r.data, meta: { cacheHit: r.cacheHit, latencyMs: Math.round((performance.now() - t0) * 100) / 100 } };
  }

  /** Reco phi-PII → cho storefront (role `connector`) dùng qua API key. */
  @Roles("marketer", "analyst", "data_steward", "connector")
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
