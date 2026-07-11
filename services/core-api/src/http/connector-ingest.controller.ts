import { Controller, Post, Body, Param, Headers, Inject, HttpCode, Res } from "@nestjs/common";
import type { Response } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { Public } from "./auth/roles.js";
import { AppError } from "./errors.js";
import { resolveInboundConnection } from "../connector/inbound.service.js";
import { ingestInboundEvent } from "../connector/inbound-ingest.service.js";
import { checkInboundRate } from "../connector/connector-inbound-ratelimit.js";

// Cổng INBOUND công khai (@Public): hệ thống ngoài (POS/PMS/webhook) đẩy event vào CDP.
// Xác thực bằng X-Connector-Token (constant-time, per source connection). brand_id lấy từ
// connection (chống spoof). Rate-limit per-connection sau xác thực. Body-size do Nest/express
// giới hạn toàn cục; zod .strict() ở schema chặn field lạ.
@Controller("v1/connectors")
export class ConnectorIngestController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Post("sources/:id/events")
  @HttpCode(202)
  async events(
    @Param("id") id: string,
    @Headers("x-connector-token") token: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Xác thực token TRƯỚC (constant-time). resolveInboundConnection ném 401 nếu sai/thiếu.
    const resolved = await resolveInboundConnection(this.pool, id, token ?? "");

    // Rate-limit per-connection SAU xác thực (giới hạn throughput source hợp lệ).
    const rl = checkInboundRate(resolved.id);
    if (!rl.allowed) {
      res.setHeader("Retry-After", rl.retryAfterSec);
      throw new AppError({
        code: "CONNECTOR_RATE_LIMIT", httpStatus: 429,
        message: "Vượt giới hạn tần suất cổng vào (per-connection).",
        why: "Connection gửi quá nhiều event trong thời gian ngắn.",
        fix: `Giảm tần suất và thử lại sau ${rl.retryAfterSec}s (xem header Retry-After).`,
        retryable: true,
      });
    }

    const result = await ingestInboundEvent(this.pool, resolved, body);
    return { data: result };
  }
}
