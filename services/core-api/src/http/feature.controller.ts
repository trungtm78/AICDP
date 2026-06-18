import { Controller, Get, Post, Param, Body, HttpCode, Inject } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { featureRecomputeSchema } from "./schemas.js";
import { AppError } from "./errors.js";
import { recomputeFeature, recomputeAllFeatures, getFeature } from "../feature/feature.service.js";
import { Roles } from "./auth/roles.js";

/** Customer feature (RFM + hành vi). Đọc: nhiều persona (cho Customer 360). Recompute: admin/steward. */
@Roles("csr", "analyst", "marketer", "data_steward")
@Controller("v1/ai/features")
export class FeatureController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get(":occId")
  async get(@Param("occId") occId: string) {
    const f = await getFeature(this.pool, occId);
    if (!f) {
      throw new AppError({
        code: "CUSTOMER_NOT_FOUND",
        httpStatus: 404,
        message: "Chưa có feature cho khách này (chưa recompute hoặc chưa phát sinh giao dịch).",
        why: "customer_feature trống cho occ_id.",
        fix: "Gọi POST /v1/ai/features/recompute hoặc tra cứu khách đã có giao dịch.",
        retryable: false,
      });
    }
    return { data: f };
  }

  /** Recompute feature: 1 khách (occId) hoặc batch toàn bộ. Chỉ admin/data_steward. */
  @Roles("admin", "data_steward")
  @Post("recompute")
  @HttpCode(200)
  async recompute(@Body() body: unknown) {
    const dto = validate(featureRecomputeSchema, body ?? {}, "feature_recompute");
    if (dto.occId) {
      return { data: await recomputeFeature(this.pool, dto.occId) };
    }
    return { data: await recomputeAllFeatures(this.pool) };
  }
}
