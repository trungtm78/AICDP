import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { IpRateLimitGuard } from "./ip-rate-limit.guard.js";
import { SkipRateLimit } from "../auth/roles.js";
import { AppError } from "../errors.js";

// Guard PRE-AUTH: chạy TRƯỚC AuthGuard, key theo IP, shed flood trước khi tốn JWT/DB lookup.
class DummyController {
  handler(): void {}

  @SkipRateLimit()
  healthHandler(): void {}
}

function makeCtx(handler: (...a: unknown[]) => void, ip: string): {
  ctx: ExecutionContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const req = { ip };
  const res = {
    setHeader: (k: string, v: string | number) => {
      headers[k] = String(v);
    },
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => DummyController,
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

const reflector = new Reflector();
const dummy = new DummyController();
const ENV = ["RATE_LIMIT_IP_BURST", "RATE_LIMIT_IP_REFILL_PER_SEC", "RATE_LIMIT_MAX_IDLE_MS"];
const clear = () => ENV.forEach((k) => delete process.env[k]);

describe("IpRateLimitGuard (pre-auth)", () => {
  beforeEach(clear);
  afterEach(clear);

  it("không cấu hình RATE_LIMIT_IP_BURST -> tắt (opt-in), luôn cho qua", () => {
    const guard = new IpRateLimitGuard(reflector);
    for (let i = 0; i < 100; i++) {
      expect(guard.canActivate(makeCtx(dummy.handler, "1.1.1.1").ctx)).toBe(true);
    }
  });

  it("vượt burst theo IP -> ném 429 + Retry-After (chặn flood trước auth)", () => {
    process.env.RATE_LIMIT_IP_BURST = "2";
    process.env.RATE_LIMIT_IP_REFILL_PER_SEC = "1";
    const guard = new IpRateLimitGuard(reflector);
    expect(guard.canActivate(makeCtx(dummy.handler, "9.9.9.9").ctx)).toBe(true);
    expect(guard.canActivate(makeCtx(dummy.handler, "9.9.9.9").ctx)).toBe(true);
    const blocked = makeCtx(dummy.handler, "9.9.9.9");
    expect(() => guard.canActivate(blocked.ctx)).toThrow(AppError);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
  });

  it("IP khác nhau độc lập", () => {
    process.env.RATE_LIMIT_IP_BURST = "1";
    process.env.RATE_LIMIT_IP_REFILL_PER_SEC = "1";
    const guard = new IpRateLimitGuard(reflector);
    expect(guard.canActivate(makeCtx(dummy.handler, "1.1.1.1").ctx)).toBe(true);
    expect(guard.canActivate(makeCtx(dummy.handler, "2.2.2.2").ctx)).toBe(true);
    expect(() => guard.canActivate(makeCtx(dummy.handler, "1.1.1.1").ctx)).toThrow();
  });

  it("@SkipRateLimit (health) luôn bỏ qua", () => {
    process.env.RATE_LIMIT_IP_BURST = "1";
    const guard = new IpRateLimitGuard(reflector);
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(makeCtx(dummy.healthHandler, "1.1.1.1").ctx)).toBe(true);
    }
  });

  it("FAIL-FAST: RATE_LIMIT_IP_BURST sai -> ném khi khởi tạo", () => {
    process.env.RATE_LIMIT_IP_BURST = "xyz";
    expect(() => new IpRateLimitGuard(reflector)).toThrow();
  });
});
