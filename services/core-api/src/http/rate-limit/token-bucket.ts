// Token bucket rate limiter (in-memory, per-key) — chống burst theo source.
// capacity = "burst" (số request tức thời cho phép); refillPerSec = tốc độ hồi token.
// Clock tiêm qua tham số nowMs để test xác định, không phụ thuộc thời gian thực.
//
// GIỚI HẠN: in-memory trong MỘT process. Khi deploy nhiều pod/worker, mỗi instance giữ
// bucket riêng -> giới hạn hiệu dụng = burst × số instance. Production đa-instance phải
// chuyển store sang Redis (xem next-step Redis). Interface giữ nguyên để thay store sau.

export interface TokenBucketConfig {
  capacity: number;
  refillPerSec: number;
  /** Loại bucket đã hồi đầy + không dùng quá ngần này ms (chống rò bộ nhớ). Bỏ qua = không loại. */
  maxIdleMs?: number;
}

export interface ConsumeResult {
  allowed: boolean;
  /** Số token còn lại (làm tròn xuống) sau lần consume này. */
  remaining: number;
  /** Khi bị chặn: số ms tới khi có đủ 1 token để retry; khi cho phép: 0. */
  retryAfterMs: number;
}

interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

// Quét loại bucket idle định kỳ sau mỗi ngần này lần consume (tránh O(n) mỗi request).
const SWEEP_EVERY_OPS = 256;

export class TokenBucketLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly maxIdleMs: number;
  private opsSinceSweep = 0;

  constructor(config: TokenBucketConfig) {
    this.capacity = config.capacity;
    this.refillPerSec = config.refillPerSec;
    this.maxIdleMs = config.maxIdleMs ?? Infinity;
  }

  tryConsume(key: string, nowMs: number): ConsumeResult {
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, lastRefillMs: nowMs };
      this.buckets.set(key, b);
    }

    // Hồi token theo thời gian trôi qua, cap ở capacity (không tích vô hạn).
    b.tokens = this.refilled(b, nowMs);
    b.lastRefillMs = nowMs;

    // Quét loại bucket idle định kỳ (chống rò bộ nhớ khi key theo IP).
    if (this.maxIdleMs !== Infinity && ++this.opsSinceSweep >= SWEEP_EVERY_OPS) {
      this.sweep(nowMs);
    }

    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    }

    // Thiếu token: tính thời gian tới khi có đủ 1 token.
    const needed = 1 - b.tokens;
    const retryAfterMs = Math.ceil((needed / this.refillPerSec) * 1000);
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  /**
   * Loại các bucket đã hồi ĐẦY (>=capacity) tại nowMs và idle quá maxIdleMs.
   * An toàn: bucket đầy khi tái tạo cũng đầy y hệt -> không cấp token miễn phí.
   * Bucket chưa hồi đầy luôn được GIỮ (loại sẽ reset sai về đầy).
   */
  sweep(nowMs: number): void {
    if (this.maxIdleMs === Infinity) return;
    this.opsSinceSweep = 0;
    for (const [key, b] of this.buckets) {
      const idleMs = nowMs - b.lastRefillMs;
      if (idleMs >= this.maxIdleMs && this.refilled(b, nowMs) >= this.capacity) {
        this.buckets.delete(key);
      }
    }
  }

  /** Số bucket đang giữ (dùng cho test/quan sát). */
  size(): number {
    return this.buckets.size;
  }

  /** Số token sau khi hồi tới nowMs (không mutate). */
  private refilled(b: BucketState, nowMs: number): number {
    const elapsedSec = Math.max(0, (nowMs - b.lastRefillMs) / 1000);
    return Math.min(this.capacity, b.tokens + elapsedSec * this.refillPerSec);
  }
}
