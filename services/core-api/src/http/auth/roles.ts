import { SetMetadata, type CustomDecorator } from "@nestjs/common";

// RBAC theo persona OCC-CDP. 'connector' dành cho POS/ingestion service-to-service.
export type Role =
  | "admin"
  | "data_steward"
  | "marketer"
  | "csr"
  | "analyst"
  | "compliance"
  | "executive"
  | "connector";

export interface AuthContext {
  role: Role;
  name: string;
  /** Định danh ổn định + duy nhất của principal (vd 'user:<uuid>' | 'key:<id>') — dùng
   *  làm khóa rate-limit (KHÔNG dùng name vì name không unique/là tên hiển thị). */
  principalId: string;
}

export const IS_PUBLIC_KEY = "isPublic";
export const ROLES_KEY = "roles";
export const SKIP_RATE_LIMIT_KEY = "skipRateLimit";

/** Route công khai (bỏ qua xác thực) — chỉ dùng cho health. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Yêu cầu caller có MỘT trong các role này (admin luôn được phép). */
export const Roles = (...roles: Role[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);

/** Bỏ qua rate-limit cho route này (vd health/liveness bị probe gọi dày). */
export const SkipRateLimit = (): CustomDecorator => SetMetadata(SKIP_RATE_LIMIT_KEY, true);
