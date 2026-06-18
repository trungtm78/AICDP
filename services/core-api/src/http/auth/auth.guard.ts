import { createHash } from "node:crypto";
import { Injectable, Inject, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
// Reflector dùng làm cả type và DI token.
import type { Request } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "../pg.provider.js";
import { AppError } from "../errors.js";
import { IS_PUBLIC_KEY, type AuthContext, type Role } from "./roles.js";
import { verifyJwt } from "../../auth/jwt.js";
import { getJwtSecret } from "../../auth/jwt-secret.js";

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

    const token = match[1]!;

    // 1) Thử JWT (người dùng đăng nhập qua admin-console).
    const payload = verifyJwt(token, getJwtSecret());
    if (payload) {
      // Lấy role HIỆN TẠI từ DB theo sub (không tin role trong token): user bị disable
      // hoặc đổi role có hiệu lực ngay, không chờ token hết hạn.
      const u = await this.pool.query<{ role: Role; name: string }>(
        "SELECT role, name FROM cdp.app_user WHERE id=$1 AND status='active'",
        [payload.sub],
      );
      if (u.rows.length === 0) {
        throw new AppError({
          code: "UNAUTHENTICATED",
          httpStatus: 401,
          message: "Phiên không còn hợp lệ (user bị vô hiệu hoặc không tồn tại).",
          why: "Không tìm thấy user active theo sub trong token.",
          fix: "Đăng nhập lại.",
          retryable: false,
        });
      }
      (req as Request & { auth: AuthContext }).auth = {
        role: u.rows[0]!.role,
        name: u.rows[0]!.name,
        // sub = app_user.id (uuid) ổn định + duy nhất -> khóa rate-limit theo principal.
        principalId: `user:${payload.sub}`,
      };
      return true;
    }

    // 2) Fallback API key (service-to-service: POS/connector).
    const keyHash = createHash("sha256").update(token).digest("hex");
    const r = await this.pool.query<{ id: string; role: Role; name: string }>(
      "SELECT id, role, name FROM cdp.api_key WHERE key_hash=$1 AND status='active'",
      [keyHash],
    );
    if (r.rows.length === 0) {
      throw new AppError({
        code: "UNAUTHENTICATED",
        httpStatus: 401,
        message: "Token không hợp lệ (JWT sai/hết hạn hoặc API key đã thu hồi).",
        why: "Không xác thực được JWT và không tìm thấy API key active khớp.",
        fix: "Đăng nhập lại để lấy JWT mới, hoặc kiểm tra API key.",
        retryable: false,
      });
    }

    (req as Request & { auth: AuthContext }).auth = {
      role: r.rows[0]!.role,
      name: r.rows[0]!.name,
      // api_key.id (bigint) duy nhất -> khóa rate-limit theo principal (không dùng name trùng được).
      principalId: `key:${r.rows[0]!.id}`,
    };
    return true;
  }
}
