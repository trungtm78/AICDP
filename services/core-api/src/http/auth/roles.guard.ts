import { Injectable, Inject, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AppError } from "../errors.js";
import { IS_PUBLIC_KEY, ROLES_KEY, type AuthContext, type Role } from "./roles.js";

/**
 * Phân quyền theo @Roles(). DENY-BY-DEFAULT: route bảo vệ mà THIẾU @Roles bị từ chối
 * (chống authz-bypass do quên annotate). Chỉ @Public() mới được bỏ qua. admin luôn qua.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    const req = ctx.switchToHttp().getRequest<Request>();
    if (!required || required.length === 0) {
      // Route bảo vệ nhưng quên @Roles -> từ chối (deny-by-default), không cho lọt.
      throw new AppError({
        code: "FORBIDDEN",
        httpStatus: 403,
        message: "Route chưa khai báo quyền (@Roles) — từ chối theo deny-by-default.",
        why: "Thiếu metadata @Roles trên handler/controller.",
        fix: "Thêm @Roles(...) hoặc @Public() cho route.",
        retryable: false,
      });
    }
    const auth = (req as Request & { auth?: AuthContext }).auth;
    // auth phải có (AuthGuard chạy trước). Public route không gắn @Roles nên không tới đây.
    if (auth && (auth.role === "admin" || required.includes(auth.role))) return true;

    throw new AppError({
      code: "FORBIDDEN",
      httpStatus: 403,
      message: "Vai trò không đủ quyền cho thao tác này.",
      why: `Cần một trong các vai trò: ${required.join(", ")}.`,
      fix: "Dùng API key có vai trò phù hợp.",
      retryable: false,
    });
  }
}
