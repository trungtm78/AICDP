import { Injectable, Inject, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { AppError } from "../errors.js";
import { IS_PUBLIC_KEY, SKIP_RATE_LIMIT_KEY, type AuthContext } from "../auth/roles.js";
import { TokenBucketLimiter } from "./token-bucket.js";
import { parsePositiveEnv, readMaxIdleMs } from "./env.js";

// Mặc định khi bật source nhưng không khai báo public: vẫn bảo vệ route public (login)
// bằng giới hạn CHẶT theo IP để chống credential stuffing / brute force.
const DEFAULT_PUBLIC_BURST = 10;
const DEFAULT_PUBLIC_REFILL_PER_SEC = 1;

/**
 * Rate-limit (chống burst) — spec RATE_LIMIT_SOURCE_BURST.
 * - Route đã xác thực: key theo `auth.principalId` (id ổn định + duy nhất, KHÔNG theo name).
 * - Route @Public (vd login): key theo IP -> chống brute force; giới hạn riêng (chặt hơn).
 * - @SkipRateLimit (health/liveness) luôn bỏ qua.
 * - Khi chặn: set Retry-After (giây) rồi ném AppError 429 (retryable).
 * - Bật khi RATE_LIMIT_SOURCE_BURST và/hoặc RATE_LIMIT_PUBLIC_BURST > 0; bật source sẽ
 *   AUTO bật public (mặc định chặt) để login không bị hở.
 * GIỚI HẠN: in-memory mỗi process; đa-instance phải chuyển store sang Redis (xem token-bucket.ts).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly sourceLimiter: TokenBucketLimiter | null;
  private readonly publicLimiter: TokenBucketLimiter | null;

  constructor(@Inject(Reflector) private readonly reflector: Reflector) {
    // Fail-fast trên cấu hình sai (ném trước khi app khởi động).
    const sourceCap = parsePositiveEnv("RATE_LIMIT_SOURCE_BURST");
    const publicCap = parsePositiveEnv("RATE_LIMIT_PUBLIC_BURST");
    const maxIdleMs = readMaxIdleMs();

    if (sourceCap === null && publicCap === null) {
      this.sourceLimiter = null;
      this.publicLimiter = null;
      return;
    }

    this.sourceLimiter =
      sourceCap === null
        ? null
        : new TokenBucketLimiter({
            capacity: sourceCap,
            refillPerSec: parsePositiveEnv("RATE_LIMIT_SOURCE_REFILL_PER_SEC") ?? sourceCap,
            maxIdleMs,
          });

    // Bật source -> AUTO bật public (mặc định chặt) nếu không khai báo: tránh login bị hở.
    const effectivePublicCap = publicCap ?? (sourceCap !== null ? DEFAULT_PUBLIC_BURST : null);
    this.publicLimiter =
      effectivePublicCap === null
        ? null
        : new TokenBucketLimiter({
            capacity: effectivePublicCap,
            refillPerSec:
              parsePositiveEnv("RATE_LIMIT_PUBLIC_REFILL_PER_SEC") ?? DEFAULT_PUBLIC_REFILL_PER_SEC,
            maxIdleMs,
          });
  }

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.sourceLimiter && !this.publicLimiter) return true; // tắt hoàn toàn.

    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_KEY, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);

    let limiter: TokenBucketLimiter | null;
    let key: string;
    if (isPublic) {
      // Route công khai (login): không có principal -> key theo IP + đường dẫn.
      limiter = this.publicLimiter;
      key = `pub:${req.path}:${this.clientIp(req)}`;
    } else {
      // Route đã xác thực: key theo principal id ổn định (fallback IP nếu thiếu).
      limiter = this.sourceLimiter;
      key = req.auth?.principalId ? `pid:${req.auth.principalId}` : `ip:${this.clientIp(req)}`;
    }
    if (!limiter) return true; // mode tương ứng không bật.

    const result = limiter.tryConsume(key, Date.now());
    if (result.allowed) return true;

    const retryAfterSec = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    ctx.switchToHttp().getResponse<Response>().setHeader("Retry-After", retryAfterSec);

    throw new AppError({
      code: "RATE_LIMIT_SOURCE_BURST",
      httpStatus: 429,
      message: "Vượt giới hạn tần suất (burst).",
      why: "Nguồn gọi đã vượt số request cho phép trong khoảng thời gian ngắn.",
      fix: `Giảm tần suất gọi và thử lại sau ${retryAfterSec}s (xem header Retry-After).`,
      retryable: true,
    });
  }

  /** IP client — chính xác sau proxy cần app.set('trust proxy', ...) ở app.factory. */
  private clientIp(req: Request): string {
    return req.ip ?? "unknown";
  }
}
