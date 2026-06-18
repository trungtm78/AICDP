import "reflect-metadata";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { Public, Roles, SkipRateLimit } from "../auth/roles.js";
import { AppError } from "../errors.js";

// Class giả lập handler để Reflector đọc metadata thật (@Public / @Roles / @SkipRateLimit).
class DummyController {
  @Public()
  publicHandler(): void {}

  @Roles("connector")
  protectedHandler(): void {}

  @Public()
  @SkipRateLimit()
  healthHandler(): void {}
}

interface CtxOpts {
  handler: (...args: unknown[]) => void;
  auth?: { role: string; name: string; principalId: string };
  ip?: string;
  path?: string;
}

function makeCtx(opts: CtxOpts): { ctx: ExecutionContext; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const req = { auth: opts.auth, ip: opts.ip ?? "10.0.0.1", path: opts.path ?? "/v1/x" };
  const res = {
    setHeader: (k: string, v: string | number) => {
      headers[k] = String(v);
    },
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => opts.handler,
    getClass: () => DummyController,
  } as unknown as ExecutionContext;
  return { ctx, headers };
}

const reflector = new Reflector();
const dummy = new DummyController();
const ALL_ENV = [
  "RATE_LIMIT_SOURCE_BURST",
  "RATE_LIMIT_SOURCE_REFILL_PER_SEC",
  "RATE_LIMIT_PUBLIC_BURST",
  "RATE_LIMIT_PUBLIC_REFILL_PER_SEC",
  "RATE_LIMIT_MAX_IDLE_MS",
];

function clearEnv() {
  for (const k of ALL_ENV) delete process.env[k];
}

const principal = (id: string) => ({ role: "connector", name: "shared-name", principalId: id });

describe("RateLimitGuard", () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  it("không cấu hình gì -> tắt, luôn cho qua", () => {
    const guard = new RateLimitGuard(reflector);
    for (let i = 0; i < 100; i++) {
      expect(guard.canActivate(makeCtx({ handler: dummy.protectedHandler, auth: principal("key:1") }).ctx)).toBe(true);
    }
  });

  it("@SkipRateLimit (health) không bao giờ bị giới hạn dù burst nhỏ", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "1";
    process.env.RATE_LIMIT_PUBLIC_BURST = "1";
    const guard = new RateLimitGuard(reflector);
    for (let i = 0; i < 10; i++) {
      expect(guard.canActivate(makeCtx({ handler: dummy.healthHandler }).ctx)).toBe(true);
    }
  });

  it("giới hạn THEO principalId (KHÔNG theo name): cùng name khác principalId là độc lập", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "1";
    process.env.RATE_LIMIT_SOURCE_REFILL_PER_SEC = "1";
    const guard = new RateLimitGuard(reflector);
    const a = () => guard.canActivate(makeCtx({ handler: dummy.protectedHandler, auth: principal("key:1") }).ctx);
    const b = () => guard.canActivate(makeCtx({ handler: dummy.protectedHandler, auth: principal("key:2") }).ctx);
    expect(a()).toBe(true);
    expect(b()).toBe(true); // cùng name 'shared-name' nhưng principalId khác -> không ảnh hưởng
    expect(() => a()).toThrow(); // key:1 đã cạn
  });

  it("cùng principalId chia sẻ bucket -> vượt burst ném 429 RATE_LIMIT_SOURCE_BURST + Retry-After", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "2";
    process.env.RATE_LIMIT_SOURCE_REFILL_PER_SEC = "1";
    const guard = new RateLimitGuard(reflector);
    const a = principal("key:1");
    expect(guard.canActivate(makeCtx({ handler: dummy.protectedHandler, auth: a }).ctx)).toBe(true);
    expect(guard.canActivate(makeCtx({ handler: dummy.protectedHandler, auth: a }).ctx)).toBe(true);
    const blocked = makeCtx({ handler: dummy.protectedHandler, auth: a });
    try {
      guard.canActivate(blocked.ctx);
      throw new Error("đáng lẽ phải ném 429");
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).httpStatus).toBe(429);
      expect((e as AppError).code).toBe("RATE_LIMIT_SOURCE_BURST");
      expect((e as AppError).retryable).toBe(true);
    }
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThanOrEqual(1);
  });

  it("login (@Public) bị giới hạn THEO IP khi bật source (public auto-default) -> chống brute force", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "100"; // source rộng cho POS
    process.env.RATE_LIMIT_PUBLIC_BURST = "2"; // public chặt cho login
    process.env.RATE_LIMIT_PUBLIC_REFILL_PER_SEC = "1";
    const guard = new RateLimitGuard(reflector);
    const login = (ip: string) =>
      guard.canActivate(makeCtx({ handler: dummy.publicHandler, ip, path: "/v1/auth/login" }).ctx);
    expect(login("1.1.1.1")).toBe(true);
    expect(login("1.1.1.1")).toBe(true);
    expect(() => login("1.1.1.1")).toThrow(); // IP này đã cạn
    expect(login("2.2.2.2")).toBe(true); // IP khác độc lập
  });

  it("bật source nhưng KHÔNG khai báo public -> public auto-bật mặc định (login vẫn được bảo vệ)", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "5";
    process.env.RATE_LIMIT_SOURCE_REFILL_PER_SEC = "0.001"; // chậm để không refill
    const guard = new RateLimitGuard(reflector);
    // public auto-default burst hữu hạn -> spam login cùng IP cuối cùng phải bị chặn.
    let blocked = false;
    for (let i = 0; i < 200; i++) {
      try {
        guard.canActivate(makeCtx({ handler: dummy.publicHandler, ip: "9.9.9.9", path: "/v1/auth/login" }).ctx);
      } catch {
        blocked = true;
        break;
      }
    }
    expect(blocked).toBe(true);
  });

  it("FAIL-FAST: env burst không hợp lệ (không phải số) -> ném ngay khi khởi tạo (không âm thầm tắt)", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "abc";
    expect(() => new RateLimitGuard(reflector)).toThrow();
  });

  it("FAIL-FAST: burst <= 0 -> ném (cấu hình vô nghĩa)", () => {
    process.env.RATE_LIMIT_PUBLIC_BURST = "0";
    expect(() => new RateLimitGuard(reflector)).toThrow();
  });

  it("env trống (chuỗi rỗng) -> coi như không cấu hình, KHÔNG ném", () => {
    process.env.RATE_LIMIT_SOURCE_BURST = "";
    expect(() => new RateLimitGuard(reflector)).not.toThrow();
  });
});
