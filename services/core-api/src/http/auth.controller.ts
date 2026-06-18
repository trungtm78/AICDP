import { Controller, Post, Get, Body, Param, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import {
  loginSchema,
  createUserSchema,
  userStatusSchema,
  apiKeyCreateSchema,
} from "./schemas.js";
import { AppError } from "./errors.js";
import { Public, Roles } from "./auth/roles.js";
import { login, createUser, listUsers, setUserStatus } from "../auth/user.service.js";
import { listApiKeys, createApiKey, revokeApiKey } from "../auth/apikey.service.js";

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
}

