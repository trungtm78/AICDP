import { z } from "zod";
import { AppError } from "./errors.js";

/**
 * Parse dữ liệu theo zod schema; nếu lỗi -> AppError với code/field_path chuẩn.
 * invalid_type + received undefined => thiếu field bắt buộc; còn lại => sai kiểu.
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown, docsAnchor?: string): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const issue = result.error.issues[0]!;
  const fieldPath = issue.path.length > 0 ? issue.path.join(".") : null;
  const missing =
    issue.code === "invalid_type" &&
    (issue as { received?: string }).received === "undefined";

  throw new AppError({
    code: missing ? "SCHEMA_MISSING_REQUIRED_FIELD" : "SCHEMA_TYPE_MISMATCH",
    httpStatus: 400,
    message: missing
      ? `Thiếu field bắt buộc: ${fieldPath ?? "(không rõ)"}`
      : `Sai kiểu dữ liệu tại: ${fieldPath ?? "(không rõ)"} — ${issue.message}`,
    why: issue.message,
    fix: missing
      ? `Thêm field "${fieldPath}" vào payload theo tracking-plan-spec.`
      : `Sửa kiểu dữ liệu của "${fieldPath}" cho đúng spec.`,
    fieldPath,
    retryable: false,
    ...(docsAnchor !== undefined ? { docsAnchor } : {}),
  });
}
