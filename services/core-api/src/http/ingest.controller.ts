import { Controller, Post, Body, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { CH_CLIENT } from "./ch.provider.js";
import { REDIS } from "./redis.provider.js";
import type { Redis } from "ioredis";
import type { Ch } from "../clickhouse/client.js";
import { projectOrderBestEffort } from "../clickhouse/project.js";
import { invalidateCache } from "../personalization/rt.service.js";
import { validate } from "./validate.js";
import { orderCompletedSchema, identifySchema } from "./schemas.js";
import { AppError } from "./errors.js";
import { Roles } from "./auth/roles.js";
import { normalizeIdentifier } from "../identity/normalize.js";
import type { RawIdentifier } from "../identity/identity.repo.js";
import {
  ingestOrderCompleted,
  ingestIdentify,
  type OrderCompletedEvent,
  type IdentifyEvent,
} from "../ingestion/ingestion.service.js";
import { enrollEventJourneys } from "../journey/journey-triggers.service.js";

const SUPPORTED = new Set(["order_completed", "identify"]);

/** Endpoint ingestion v1: chỉ order_completed + identify (tracking-plan-spec mục 10). */
// Ingestion từ POS/connector (service-to-service).
@Roles("connector")
@Controller("v1")
export class IngestController {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(CH_CLIENT) private readonly ch: Ch,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

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
      const orderEvent = toOrderEvent(dto);
      const result = await ingestOrderCompleted(this.pool, orderEvent);
      // Project sang ClickHouse SAU khi PG commit, FIRE-AND-FORGET (không chặn 202).
      // Chỉ project bản ghi MỚI (không idempotent-replay). Lỗi CH đã nuốt trong helper.
      if (!result.idempotent) {
        void projectOrderBestEffort(this.ch, orderEvent, result.messageId, result.occId);
        // Journey event-trigger: enroll khách vào journey kiểu event khớp 'order_completed'.
        // FIRE-AND-FORGET — KHÔNG chặn 202 (giống projection CH). Miss enroll thì segment-scan/
        // lần mua sau bắt lại (PG là SoR). Lỗi được LOG (không nuốt im lặng) để quan sát; outbox
        // bền là hardening R1.7.
        if (result.occId) {
          const occId = result.occId;
          void enrollEventJourneys(this.pool, occId, "order_completed").catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.warn(`[ingest] enroll journey event thất bại occ=${occId}:`, (err as Error).message);
          });
        }
      }
      // Merge danh tính -> invalidate cache Redis của occ bị gộp (fire-and-forget).
      void invalidateCache(this.redis, result.mergedOccIds ?? []);
      return { data: result };
    }

    const dto = validate(identifySchema, body, "identify");
    // identify bắt buộc có identifier (schema min 1); nếu tất cả sai chuẩn -> 400.
    assertIdentifiersValidIfPresent(dto.identifiers, dto.brand_id);
    const result = await ingestIdentify(this.pool, toIdentifyEvent(dto));
    void invalidateCache(this.redis, result.mergedOccIds);
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
