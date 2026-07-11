import { Controller, Get, Post, Body, Param, Query, Headers, Inject, HttpCode, Res } from "@nestjs/common";
import type { Response } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { Public } from "./auth/roles.js";
import { AppError } from "./errors.js";
import { resolveInboundConnection, resolveWriteKeyConnection } from "../connector/inbound.service.js";
import { ingestInboundEvent } from "../connector/inbound-ingest.service.js";
import { mapSegmentPayload } from "../connector/segment-map.js";
import { processPaymentIpn } from "../connector/payment/payment-ipn.service.js";
import { checkInboundRate } from "../connector/connector-inbound-ratelimit.js";

/** Rút write-key: ưu tiên X-Write-Key; nếu không, giải mã Basic auth chuẩn Segment (writeKey:''). */
export function extractWriteKey(authHeader: string | undefined, xWriteKey: string | undefined): string {
  if (xWriteKey && xWriteKey.trim() !== "") return xWriteKey.trim();
  const m = /^Basic\s+(.+)$/i.exec((authHeader ?? "").trim());
  if (!m) return "";
  try {
    const decoded = Buffer.from(m[1]!, "base64").toString("utf8");
    return decoded.slice(0, decoded.indexOf(":") >= 0 ? decoded.indexOf(":") : decoded.length);
  } catch {
    return "";
  }
}

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

  // Cổng write-key shape Segment/RudderStack: SDK gửi track/identify, xác thực bằng writeKey.
  @Public()
  @Post("track")
  @HttpCode(202)
  async track(
    @Headers("authorization") authHeader: string | undefined,
    @Headers("x-write-key") xWriteKey: string | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const writeKey = extractWriteKey(authHeader, xWriteKey);
    const resolved = await resolveWriteKeyConnection(this.pool, writeKey);

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

    // Map Segment -> shape inbound rồi tái dùng ingestInboundEvent (validation + ghi event).
    const mapped = mapSegmentPayload(body, resolved.config);
    const result = await ingestInboundEvent(this.pool, resolved, mapped);
    return { data: result };
  }

  // Cổng IPN thanh toán (VNPay/MoMo/ZaloPay): verify checksum trong service (fail-closed).
  // VNPay gọi IPN qua GET query; MoMo/ZaloPay POST body -> nhận cả hai, gộp query+body.
  // Trả ACK ĐÚNG ĐỊNH DẠNG cổng (KHÔNG bọc {data}) để cổng đọc RspCode/return_code.
  @Public()
  @Post("payment/:id/ipn")
  @HttpCode(200)
  async paymentIpnPost(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const payload = { ...(query ?? {}), ...((body as Record<string, unknown>) ?? {}) };
    return this.paymentIpn(id, payload, res);
  }

  @Public()
  @Get("payment/:id/ipn")
  @HttpCode(200)
  async paymentIpnGet(
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.paymentIpn(id, { ...(query ?? {}) }, res);
  }

  private async paymentIpn(id: string, payload: Record<string, unknown>, res: Response) {
    const rl = checkInboundRate(id);
    if (!rl.allowed) {
      res.setHeader("Retry-After", rl.retryAfterSec);
      throw new AppError({
        code: "CONNECTOR_RATE_LIMIT", httpStatus: 429,
        message: "Vượt giới hạn tần suất cổng IPN (per-connection).",
        why: "Connection nhận quá nhiều IPN trong thời gian ngắn.",
        fix: `Thử lại sau ${rl.retryAfterSec}s.`, retryable: true,
      });
    }
    return processPaymentIpn(this.pool, id, payload);
  }
}
