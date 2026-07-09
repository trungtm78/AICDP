import { Controller, Post, Get, Put, Delete, Body, Param, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import {
  loginSchema,
  createUserSchema,
  userStatusSchema,
  userUpdateSchema,
  apiKeyCreateSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
} from "./schemas.js";
import { AppError } from "./errors.js";
import { Public, Roles } from "./auth/roles.js";
import {
  login,
  createUser,
  listUsers,
  setUserStatus,
  updateUser,
  deleteUser,
} from "../auth/user.service.js";
import { listApiKeys, createApiKey, revokeApiKey, deleteApiKey } from "../auth/apikey.service.js";
import { requestReset, confirmReset, PasswordResetError } from "../auth/password-reset.service.js";

// Lỗi 404 khi không tìm thấy bản ghi cần cập nhật/xoá.
function notFoundError(entity: string, id: string): AppError {
  return new AppError({
    code: "NOT_FOUND",
    httpStatus: 404,
    message: `Không tìm thấy ${entity} với id đã cho.`,
    why: `Không có bản ghi ${entity} khớp id=${id}.`,
    fix: "Kiểm tra lại id.",
    retryable: false,
  });
}

/** Đăng nhập (public) + tạo user (admin). Trả JWT mang role cho admin-console. */
@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const dto = validate(loginSchema, body, "login");
    const res = await login(this.pool, dto.username, dto.password);
    if (!res) {
      throw new AppError({
        code: "UNAUTHENTICATED",
        httpStatus: 401,
        message: "Sai tên đăng nhập hoặc mật khẩu.",
        why: "Thông tin đăng nhập không khớp user active.",
        fix: "Kiểm tra lại username/password.",
        retryable: false,
      });
    }
    return { data: res };
  }

  /** Quên mật khẩu — luôn 200 ok:true (chống dò tài khoản). resetToken CHỈ lộ khi CORE_API_DEMO_RESET=1. */
  @Public()
  @Post("password-reset/request")
  @HttpCode(200)
  async passwordResetRequest(@Body() body: unknown) {
    const dto = validate(passwordResetRequestSchema, body, "password_reset_request");
    const res = await requestReset(this.pool, dto.username);
    const demo = process.env.CORE_API_DEMO_RESET === "1";
    return { data: { ok: true, ...(demo && res.token ? { resetToken: res.token } : {}) } };
  }

  /** Đặt mật khẩu mới theo token (một lần, hết hạn 30 phút). */
  @Public()
  @Post("password-reset/confirm")
  @HttpCode(200)
  async passwordResetConfirm(@Body() body: unknown) {
    const dto = validate(passwordResetConfirmSchema, body, "password_reset_confirm");
    try {
      await confirmReset(this.pool, dto.token, dto.newPassword);
    } catch (err) {
      if (err instanceof PasswordResetError) {
        throw new AppError({
          code: err.code,
          httpStatus: 400,
          message: err.message,
          why: "Token không khớp, đã hết hạn 30 phút hoặc đã được sử dụng.",
          fix: "Thực hiện lại bước Quên mật khẩu để nhận link mới.",
          retryable: false,
        });
      }
      throw err;
    }
    return { data: { ok: true } };
  }

  @Roles("admin")
  @Post("users")
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const dto = validate(createUserSchema, body, "create_user");
    return { data: await createUser(this.pool, dto) };
  }

  @Roles("admin")
  @Get("users")
  async users() {
    return { data: await listUsers(this.pool) };
  }

  @Roles("admin")
  @Post("users/:id/status")
  @HttpCode(200)
  async userStatus(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(userStatusSchema, body, "user_status");
    await setUserStatus(this.pool, id, dto.status);
    return { data: { id, status: dto.status } };
  }

  @Roles("admin")
  @Put("users/:id")
  async updateUserRoute(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(userUpdateSchema, body, "user_update");
    const ok = await updateUser(this.pool, id, dto);
    if (!ok) throw notFoundError("user", id);
    return { data: { id } };
  }

  @Roles("admin")
  @Delete("users/:id")
  async deleteUserRoute(@Param("id") id: string) {
    const ok = await deleteUser(this.pool, id);
    if (!ok) throw notFoundError("user", id);
    return { data: { deleted: true } };
  }

  @Roles("admin")
  @Get("api-keys")
  async apiKeys() {
    return { data: await listApiKeys(this.pool) };
  }

  @Roles("admin")
  @Post("api-keys")
  @HttpCode(201)
  async createKey(@Body() body: unknown) {
    const dto = validate(apiKeyCreateSchema, body, "api_key_create");
    // rawKey trả MỘT lần — client phải lưu ngay.
    return { data: await createApiKey(this.pool, dto) };
  }

  @Roles("admin")
  @Post("api-keys/:id/revoke")
  @HttpCode(200)
  async revokeKey(@Param("id") id: string) {
    await revokeApiKey(this.pool, id);
    return { data: { id, status: "revoked" } };
  }

  @Roles("admin")
  @Delete("api-keys/:id")
  async deleteKey(@Param("id") id: string) {
    const ok = await deleteApiKey(this.pool, id);
    if (!ok) throw notFoundError("api_key", id);
    return { data: { deleted: true } };
  }
}

