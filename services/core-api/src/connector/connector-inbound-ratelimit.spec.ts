import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { checkInboundRate, resetInboundLimiter } from "./connector-inbound-ratelimit.js";

// Rate-limit per-connection: burst nhỏ + refill ~0 -> vượt burst bị chặn ngay trong cùng ms.
describe("checkInboundRate", () => {
  beforeEach(() => {
    process.env.CONNECTOR_INBOUND_BURST = "2";
    process.env.CONNECTOR_INBOUND_REFILL_PER_SEC = "0.001"; // ~không hồi trong test
    resetInboundLimiter();
  });
  afterEach(() => {
    delete process.env.CONNECTOR_INBOUND_BURST;
    delete process.env.CONNECTOR_INBOUND_REFILL_PER_SEC;
    resetInboundLimiter();
  });

  it("cho phép tới hạn burst rồi chặn (429 với retryAfter>=1)", () => {
    expect(checkInboundRate("c1").allowed).toBe(true);
    expect(checkInboundRate("c1").allowed).toBe(true);
    const third = checkInboundRate("c1");
    expect(third.allowed).toBe(false);
    expect(third.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("bucket tách biệt theo connectionId", () => {
    checkInboundRate("a"); checkInboundRate("a"); // cạn bucket a
    expect(checkInboundRate("a").allowed).toBe(false);
    expect(checkInboundRate("b").allowed).toBe(true); // b độc lập
  });
});
