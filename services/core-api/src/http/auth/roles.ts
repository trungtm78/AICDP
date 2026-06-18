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
}

export const IS_PUBLIC_KEY = "isPublic";
export const ROLES_KEY = "roles";

/** Route công khai (bỏ qua xác thực) — chỉ dùng cho health. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Yêu cầu caller có MỘT trong các role này (admin luôn được phép). */
export const Roles = (...roles: Role[]): CustomDecorator => SetMetadata(ROLES_KEY, roles);
