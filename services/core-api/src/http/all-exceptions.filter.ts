import {
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { AppError, buildEnvelope } from "./errors.js";
import { getCorrelationId } from "./correlation.middleware.js";
import { LoyaltyError } from "../loyalty/loyalty.service.js";

/** Global filter: mọi lỗi -> ErrorEnvelope chuẩn (không nuốt data im lặng). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const correlationId = getCorrelationId(req);

    const appErr = this.toAppError(exception);
    // Lỗi 5xx không mong đợi: log chi tiết server-side kèm correlation_id để truy
    // vết, nhưng KHÔNG trả lỗi DB/stack thô ra client (tránh lộ thông tin nội bộ).
    if (appErr.httpStatus >= 500) {
      // eslint-disable-next-line no-console
      console.error(`[${correlationId}] ${appErr.code}:`, exception);
    }
    res.status(appErr.httpStatus).json(buildEnvelope(appErr, correlationId));
  }

  private toAppError(exception: unknown): AppError {
    if (exception instanceof AppError) return exception;

    // Lỗi nghiệp vụ loyalty -> HTTP status theo từng mã.
    if (exception instanceof LoyaltyError) {
      const statusByCode: Record<string, number> = {
        INVALID_AMOUNT: 400,
        INSUFFICIENT_BALANCE: 409,
        INSUFFICIENT_RESERVED: 409,
        RESERVATION_NOT_FOUND: 404,
        RESERVATION_INVALID_STATE: 409,
        IDEMPOTENCY_CONFLICT: 409,
        CURRENCY_NOT_FOUND: 400,
        CONVERSION_NOT_FOUND: 400,
        REWARD_NOT_FOUND: 404,
        TIER_REQUIRED: 403,
        OUT_OF_STOCK: 409,
        VOUCHER_NOT_FOUND: 404,
        VOUCHER_INVALID_STATE: 409,
        VOUCHER_BRAND_MISMATCH: 400,
        SETTLEMENT_PRICE_MISSING: 409,
      };
      return new AppError({
        code: exception.code,
        httpStatus: statusByCode[exception.code] ?? 409,
        message: exception.message,
        why: "Vi phạm bất biến sổ điểm (double-entry / cấm âm / state machine).",
        fix:
          exception.code === "INVALID_AMOUNT"
            ? "Gửi số điểm là số nguyên dương trong giới hạn."
            : "Kiểm tra số dư / trạng thái reservation / idempotency key trước khi thao tác.",
        retryable: false,
      });
    }

    // Vi phạm UNIQUE Postgres (vd idempotency, trùng store_id) -> 409.
    const pgCode = (exception as { code?: string } | null)?.code;
    if (pgCode === "23505") {
      return new AppError({
        code: "IDEMPOTENCY_CONFLICT",
        httpStatus: 409,
        message: "Bản ghi đã tồn tại (vi phạm ràng buộc duy nhất).",
        why: "Khóa duy nhất đã tồn tại trong DB.",
        fix: "Kiểm tra id/khóa idempotency; nếu retry, dùng cùng khóa để nhận kết quả idempotent.",
        retryable: false,
      });
    }
    // FK vi phạm (vd brand_id không tồn tại) -> 400.
    if (pgCode === "23503") {
      return new AppError({
        code: "SCHEMA_TYPE_MISMATCH",
        httpStatus: 400,
        message: "Tham chiếu không hợp lệ (khóa ngoại không tồn tại).",
        why: "Giá trị tham chiếu (vd brand_id) chưa tồn tại trong master data.",
        fix: "Tạo bản ghi cha trước, hoặc sửa lại giá trị tham chiếu.",
        retryable: false,
      });
    }

    if (pgCode === "22P02") {
      // Sai kiểu dữ liệu đầu vào (vd :id không phải UUID hợp lệ) -> lỗi CLIENT 400, không phải 500.
      return new AppError({
        code: "SCHEMA_TYPE_MISMATCH",
        httpStatus: 400,
        message: "Tham số không hợp lệ (sai định dạng, vd id phải là UUID).",
        why: "Giá trị gửi lên không đúng kiểu dữ liệu cột.",
        fix: "Kiểm tra lại định dạng tham số (UUID/số/ngày).",
        retryable: false,
      });
    }

    if (exception instanceof HttpException) {
      // Lỗi framework. Lỗi nghiệp vụ (customer-not-found) đã là AppError ở nhánh trên.
      const status = exception.getStatus();
      // 4xx của framework là lỗi client (vd JSON body hỏng -> 400 BadRequest).
      // Gắn nhãn schema để client xử lý đúng, không nhầm thành lỗi nội bộ.
      if (status === 400) {
        return new AppError({
          code: "SCHEMA_TYPE_MISMATCH",
          httpStatus: 400,
          message: "Body request không hợp lệ (JSON sai hoặc sai cấu trúc).",
          why: "Không parse/validate được body theo định dạng mong đợi.",
          fix: "Gửi JSON hợp lệ đúng schema endpoint.",
          retryable: false,
        });
      }
      return new AppError({
        code: "INTERNAL",
        httpStatus: status,
        message: exception.message,
        why: "Lỗi HTTP từ framework (không khớp route/handler nào).",
        fix: "Kiểm tra method + đường dẫn endpoint.",
        retryable: status >= 500,
      });
    }

    return new AppError({
      code: "INTERNAL",
      httpStatus: 500,
      message: "Lỗi nội bộ không mong đợi.",
      // KHÔNG nhúng message lỗi thô (có thể lộ chi tiết DB) — đã log server-side.
      why: "Đã ghi log chi tiết phía server.",
      fix: "Liên hệ vận hành kèm correlation_id để truy vết.",
      retryable: true,
    });
  }
}
