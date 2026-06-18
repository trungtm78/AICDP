import { Controller, Post, Body, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { orderCompletedSchema, identifySchema } from "./schemas.js";
import { AppError } from "./errors.js";
import { normalizeIdentifier } from "../identity/normalize.js";
import type { RawIdentifier } from "../identity/identity.repo.js";
import {
  ingestOrderCompleted,
  ingestIdentify,
  type OrderCompletedEvent,
  type IdentifyEvent,
} from "../ingestion/ingestion.service.js";

const SUPPORTED = new Set(["order_completed", "identify"]);

/** Endpoint ingestion v1: chỉ order_completed + identify (tracking-plan-spec mục 10). */
@Controller("v1")
export class IngestController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Post("ingest")
  @HttpCode(202)
  async ingest(@Body() body: unknown) {
    const type = (body as { type?: unknown } | null)?.type;
    if (typeof type !== "string" || !SUPPORTED.has(type)) {
      throw new AppError({
        code: "UNKNOWN_EVENT_TYPE",
        httpStatus: 400,
        message: `Loại event không hỗ trợ ở v1: ${String(type)}`,
        why: "v1 chỉ nhận 'order_completed' và 'identify'.",
        fix: "Gửi type hợp lệ; event hành vi (page/app/lead) thuộc v2+.",
        fieldPath: "type",
        retryable: false,
      });
    }

    if (type === "order_completed") {
      const dto = validate(orderCompletedSchema, body, "order_completed");
      // Identifier là optional (KH ẩn danh hợp lệ). Nhưng nếu CÓ gửi mà TẤT CẢ
      // không hợp lệ -> báo lỗi rõ ràng, KHÔNG nuốt im lặng rồi ghi giao dịch mồ côi.
      assertIdentifiersValidIfPresent(dto.identifiers, dto.brand_id);
      const result = await ingestOrderCompleted(this.pool, toOrderEvent(dto));
      return { data: result };
    }

    const dto = validate(identifySchema, body, "identify");
    // identify bắt buộc có identifier (schema min 1); nếu tất cả sai chuẩn -> 400.
    assertIdentifiersValidIfPresent(dto.identifiers, dto.brand_id);
    const result = await ingestIdentify(this.pool, toIdentifyEvent(dto));
    return { data: result };
  }
}

/** Ném INVALID_IDENTIFIER nếu có identifier nhưng không cái nào chuẩn hóa được. */
function assertIdentifiersValidIfPresent(
  identifiers: RawIdentifier[] | undefined,
  brandId: string,
): void {
  if (!identifiers || identifiers.length === 0) return;
  const anyValid = identifiers.some(
    (id) => normalizeIdentifier(id.type, id.value, { brandId }) !== null,
  );
  if (!anyValid) {
    throw new AppError({
      code: "INVALID_IDENTIFIER",
      httpStatus: 400,
      message: "Tất cả identifier gửi lên đều không hợp lệ sau chuẩn hóa.",
      why: "Không identifier nào vượt qua chuẩn hóa (vd phone/email sai định dạng).",
      fix: "Sửa định dạng identifier (phone E.164 VN, email hợp lệ...) rồi gửi lại.",
      fieldPath: "identifiers",
      retryable: false,
    });
  }
}

function toOrderEvent(
  dto: ReturnType<typeof orderCompletedSchema.parse>,
): OrderCompletedEvent {
  const { type: _type, ...rest } = dto;
  return rest as OrderCompletedEvent;
}

function toIdentifyEvent(
  dto: ReturnType<typeof identifySchema.parse>,
): IdentifyEvent {
  const { type: _type, ...rest } = dto;
  return rest as IdentifyEvent;
}
