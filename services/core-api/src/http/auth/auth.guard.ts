import { createHash } from "node:crypto";
import { Injectable, Inject, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
// Reflector dùng làm cả type và DI token.
import type { Request } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "../pg.provider.js";
import { AppError } from "../errors.js";
import { IS_PUBLIC_KEY, type AuthContext, type Role } from "./roles.js";

/** Xác thực Bearer API key (sha256 hex) -> gắn request.auth = {role,name}. Deny-by-default. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    // @Inject tường minh: tsx/esbuild không emit design:paramtypes -> không suy được Reflector.
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match) {
      throw new AppError({
        code: "UNAUTHENTICATED",
        httpStatus: 401,
        message: "Thiếu hoặc sai Authorization Bearer token.",
        why: "Request không kèm API key hợp lệ.",
        fix: "Gửi header 'Authorization: Bearer <api_key>'.",
        retryable: false,
      });
    }

    const keyHash = createHash("sha256").update(match[1]!).digest("hex");
    const r = await this.pool.query<{ role: Role; name: string }>(
      "SELECT role, name FROM cdp.api_key WHERE key_hash=$1 AND status='active'",
      [keyHash],
    );
    if (r.rows.length === 0) {
      throw new AppError({
        code: "UNAUTHENTICATED",
        httpStatus: 401,
        message: "API key không hợp lệ hoặc đã thu hồi.",
        why: "Không tìm thấy key active khớp.",
        fix: "Kiểm tra lại API key.",
        retryable: false,
      });
    }

    (req as Request & { auth: AuthContext }).auth = {
      role: r.rows[0]!.role,
      name: r.rows[0]!.name,
    };
    return true;
  }
}
