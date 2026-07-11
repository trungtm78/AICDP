import { TokenBucketLimiter } from "../http/rate-limit/token-bucket.js";
import { parsePositiveEnv, readMaxIdleMs } from "../http/rate-limit/env.js";

// Rate-limit PER-CONNECTION cho cổng webhook @Public — LUÔN bật (không phụ thuộc guard env-gated),
// vì route công khai không có principal để RateLimitGuard khoá. Áp SAU khi xác thực token (giới hạn
// throughput của source hợp lệ); flood chưa-xác-thực do IpRateLimitGuard/edge WAF chặn.
// Mặc định 120 burst, hồi 20/s — dư cho POS realtime, vẫn chặn spike. Chỉnh qua env.

const DEFAULT_BURST = 120;
const DEFAULT_REFILL_PER_SEC = 20;

let limiter: TokenBucketLimiter | null = null;

function get(): TokenBucketLimiter {
  if (!limiter) {
    limiter = new TokenBucketLimiter({
      capacity: parsePositiveEnv("CONNECTOR_INBOUND_BURST") ?? DEFAULT_BURST,
      refillPerSec: parsePositiveEnv("CONNECTOR_INBOUND_REFILL_PER_SEC") ?? DEFAULT_REFILL_PER_SEC,
      maxIdleMs: readMaxIdleMs(),
    });
  }
  return limiter;
}

/** Chỉ dùng cho test: dựng lại limiter sau khi đổi env. */
export function resetInboundLimiter(): void {
  limiter = null;
}

export interface InboundRateResult {
  allowed: boolean;
  retryAfterSec: number;
}

/** Tiêu thụ 1 token của bucket theo connectionId. Không ném — caller quyết định 429 + header. */
export function checkInboundRate(connectionId: string): InboundRateResult {
  const r = get().tryConsume(`conn:${connectionId}`, Date.now());
  return { allowed: r.allowed, retryAfterSec: Math.max(1, Math.ceil(r.retryAfterMs / 1000)) };
}
