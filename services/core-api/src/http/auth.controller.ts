import { Controller, Post, Body, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { loginSchema, createUserSchema } from "./schemas.js";
import { AppError } from "./errors.js";
import { Public, Roles } from "./auth/roles.js";
import { login, createUser } from "../auth/user.service.js";

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
}
