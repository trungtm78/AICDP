import { Injectable, Inject, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppError } from "../errors.js";
import { SKIP_RATE_LIMIT_KEY } from "../auth/roles.js";
import { TokenBucketLimiter } from "./token-bucket.js";
import { parsePositiveEnv, readMaxIdleMs } from "./env.js";

/**
 * Rate-limit PRE-AUTH theo IP (opt-in qua RATE_LIMIT_IP_BURST). Chạy TRƯỚC AuthGuard để
 * SHED flood request (kể cả token sai) TRƯỚC khi tốn JWT-verify + DB lookup. Đây là lớp
 * coarse-grained; bảo vệ fine-grained (per-principal / login) ở RateLimitGuard sau auth.
 * @SkipRateLimit (health/liveness) bỏ qua. Khi chặn: Retry-After + AppError 429 (retryable).
 *
 * LƯU Ý vận hành: chống flood unauth toàn diện nên đặt thêm ở edge (WAF/gateway/nginx
 * limit_req). Cần app.set('trust proxy', ...) (TRUST_PROXY) để req.ip là IP client thật.
 * GIỚI HẠN: in-memory mỗi process; đa-instance cần Redis (xem token-bucket.ts).
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly limiter: TokenBucketLimiter | null;

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    const cap = parsePositiveEnv("RATE_LIMIT_IP_BURST");
    this.limiter =
      cap === null
        ? null
        : new TokenBucketLimiter({
            capacity: cap,
            refillPerSec: parsePositiveEnv("RATE_LIMIT_IP_REFILL_PER_SEC") ?? cap,
            maxIdleMs: readMaxIdleMs(),
          });
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.limiter) return true; // opt-in: không cấu hình -> tắt.

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const result = this.limiter.tryConsume(`ip:${req.ip ?? "unknown"}`, Date.now());
    if (result.allowed) return true;

    const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    ctx.switchToHttp().getResponse<Response>().setHeader("Retry-After", retryAfterSec);

    throw new AppError({
      code: "RATE_LIMIT_SOURCE_BURST",
      httpStatus: 429,
      message: "Vượt giới hạn tần suất theo IP (burst).",
      why: "IP nguồn gửi quá nhiều request trong khoảng thời gian ngắn.",
      fix: `Giảm tần suất gọi và thử lại sau ${retryAfterSec}s (xem header Retry-After).`,
      retryable: true,
    });
  }
}
