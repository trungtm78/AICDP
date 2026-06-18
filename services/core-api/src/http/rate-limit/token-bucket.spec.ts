import { describe, it, expect } from "vitest";
import { TokenBucketLimiter } from "./token-bucket.js";

// Token bucket: capacity = "burst" (số request tức thời cho phép), refillPerSec = tốc độ hồi token.
describe("TokenBucketLimiter", () => {
  it("cho phép tối đa 'capacity' request liên tiếp (burst), request kế tiếp bị chặn", () => {
    const lim = new TokenBucketLimiter({ capacity: 3, refillPerSec: 1 });
    const now = 1_000_000;
    expect(lim.tryConsume("k", now).allowed).toBe(true);
    expect(lim.tryConsume("k", now).allowed).toBe(true);
    expect(lim.tryConsume("k", now).allowed).toBe(true);
    // Hết token -> chặn.
    expect(lim.tryConsume("k", now).allowed).toBe(false);
  });

  it("báo remaining giảm dần và về 0 khi cạn", () => {
    const lim = new TokenBucketLimiter({ capacity: 2, refillPerSec: 1 });
    const now = 0;
    expect(lim.tryConsume("k", now).remaining).toBe(1);
    expect(lim.tryConsume("k", now).remaining).toBe(0);
    expect(lim.tryConsume("k", now).remaining).toBe(0);
  });

  it("refill theo thời gian: sau đủ thời gian thì cho phép trở lại", () => {
    const lim = new TokenBucketLimiter({ capacity: 1, refillPerSec: 2 });
    const t0 = 5_000;
    expect(lim.tryConsume("k", t0).allowed).toBe(true);
    expect(lim.tryConsume("k", t0).allowed).toBe(false);
    // refillPerSec=2 -> 1 token hồi sau 500ms.
    expect(lim.tryConsume("k", t0 + 499).allowed).toBe(false);
    expect(lim.tryConsume("k", t0 + 500).allowed).toBe(true);
  });

  it("retryAfterMs > 0 và phản ánh thời gian tới khi có 1 token khi bị chặn", () => {
    const lim = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
    const t0 = 0;
    lim.tryConsume("k", t0); // dùng hết
    const res = lim.tryConsume("k", t0);
    expect(res.allowed).toBe(false);
    // refillPerSec=1 -> cần 1000ms để có 1 token.
    expect(res.retryAfterMs).toBe(1000);
    // được phép -> retryAfterMs = 0.
    const ok = lim.tryConsume("k2", t0);
    expect(ok.retryAfterMs).toBe(0);
  });

  it("các key độc lập với nhau", () => {
    const lim = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
    expect(lim.tryConsume("a", 0).allowed).toBe(true);
    expect(lim.tryConsume("b", 0).allowed).toBe(true); // key khác không bị ảnh hưởng
    expect(lim.tryConsume("a", 0).allowed).toBe(false);
  });

  it("refill không vượt quá capacity (không tích token vô hạn khi idle lâu)", () => {
    const lim = new TokenBucketLimiter({ capacity: 2, refillPerSec: 1 });
    const t0 = 0;
    // idle rất lâu -> token cap ở capacity, không thành 100.
    lim.tryConsume("k", t0); // 2 -> 1
    const far = t0 + 100_000;
    expect(lim.tryConsume("k", far).allowed).toBe(true); // 2
    expect(lim.tryConsume("k", far).allowed).toBe(true); // 1
    expect(lim.tryConsume("k", far).allowed).toBe(false); // 0 -> chặn (chỉ cap=2, không phải 100)
  });

  describe("eviction (chống tích bucket vô hạn -> rò bộ nhớ)", () => {
    it("sweep loại bucket đã hồi đầy + idle quá maxIdleMs; giữ bucket còn hoạt động", () => {
      const lim = new TokenBucketLimiter({ capacity: 2, refillPerSec: 1, maxIdleMs: 10_000 });
      lim.tryConsume("idle", 0); // bucket 'idle' không dùng lại nữa
      lim.tryConsume("active", 0);
      expect(lim.size()).toBe(2);
      // tại t=20s: 'idle' đã hồi đầy (>=capacity) + idle>maxIdleMs -> bị loại; 'active' vừa dùng -> giữ.
      lim.tryConsume("active", 20_000);
      lim.sweep(20_000);
      expect(lim.size()).toBe(1);
      // 'idle' bị loại nhưng tạo lại y hệt (đầy token) -> không cấp token miễn phí sai.
      expect(lim.tryConsume("idle", 20_000).remaining).toBe(1);
    });

    it("KHÔNG loại bucket chưa hồi đầy (tránh cấp token miễn phí khi tái tạo)", () => {
      const lim = new TokenBucketLimiter({ capacity: 5, refillPerSec: 0.001, maxIdleMs: 1000 });
      lim.tryConsume("k", 0); // còn 4 token, hồi rất chậm
      lim.sweep(5000); // idle>maxIdleMs nhưng chưa hồi đầy -> phải giữ
      expect(lim.size()).toBe(1);
    });

    it("không cấu hình maxIdleMs -> không bao giờ tự loại (giữ nguyên hành vi)", () => {
      const lim = new TokenBucketLimiter({ capacity: 1, refillPerSec: 1 });
      lim.tryConsume("k", 0);
      lim.sweep(10_000_000);
      expect(lim.size()).toBe(1);
    });
  });
});
