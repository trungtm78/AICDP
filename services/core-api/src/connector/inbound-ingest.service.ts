import type { Pool } from "pg";
import { AppError } from "../http/errors.js";
import { validate } from "../http/validate.js";
import { inboundOrderSchema, inboundIdentifySchema } from "../http/schemas.js";
import { recordEvent } from "./logs.service.js";
import {
  ingestOrderCompleted,
  ingestIdentify,
  type OrderCompletedEvent,
  type IdentifyEvent,
} from "../ingestion/ingestion.service.js";
import { normalizeIdentifier } from "../identity/normalize.js";
import type { RawIdentifier } from "../identity/identity.repo.js";
import type { ResolvedInbound } from "./inbound.service.js";

// Map + nạp 1 event INBOUND (từ webhook đã xác thực token) vào pipeline ingest chuẩn.
// NGUYÊN TẮC bảo mật: brand_id LẤY TỪ connection (chống spoof, external không tự khai brand);
// mọi nhánh lỗi ĐỀU ghi connector_event 'rejected' (không nuốt data im lặng).

export interface InboundIngestResult {
  accepted: true;
  type: "order_completed" | "identify";
  messageId?: string;
  occId: string | null;
  idempotent?: boolean;
  mergedOccIds?: string[];
}

/** brand_id gắn với source connection (config.brand_id | config.brandId). Bắt buộc để quy thuộc. */
function readBrandId(config: Record<string, unknown>): string | null {
  const v = config["brand_id"] ?? config["brandId"];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Ném INVALID_IDENTIFIER nếu có identifier nhưng không cái nào chuẩn hóa được (chống giao dịch mồ côi). */
function assertIdentifiersValidIfPresent(identifiers: RawIdentifier[] | undefined, brandId: string): void {
  if (!identifiers || identifiers.length === 0) return;
  const anyValid = identifiers.some((i) => normalizeIdentifier(i.type, i.value, { brandId }) !== null);
  if (!anyValid) {
    throw new AppError({
      code: "INVALID_IDENTIFIER", httpStatus: 400,
      message: "Tất cả identifier gửi lên đều không hợp lệ sau chuẩn hóa.",
      why: "Không identifier nào vượt qua chuẩn hóa (vd phone/email sai định dạng).",
      fix: "Sửa định dạng identifier (phone E.164 VN, email hợp lệ...) rồi gửi lại.",
      fieldPath: "identifiers", retryable: false,
    });
  }
}

export async function ingestInboundEvent(
  pool: Pool,
  resolved: ResolvedInbound,
  payload: unknown,
): Promise<InboundIngestResult> {
  const rawType = (payload as { type?: unknown } | null)?.type;
  const eventType = typeof rawType === "string" ? rawType : "unknown";
  try {
    if (eventType !== "order_completed" && eventType !== "identify") {
      throw new AppError({
        code: "UNKNOWN_EVENT_TYPE", httpStatus: 400,
        message: `Loại event không hỗ trợ ở cổng vào: ${eventType}`,
        why: "Cổng webhook v1 chỉ nhận 'order_completed' và 'identify'.",
        fix: "Gửi type hợp lệ.", fieldPath: "type", retryable: false,
      });
    }

    const brandId = readBrandId(resolved.config);
    if (!brandId) {
      throw new AppError({
        code: "CONNECTOR_MISCONFIGURED", httpStatus: 400,
        message: "Kết nối nguồn chưa gắn brand_id trong cấu hình.",
        why: "brand_id được lấy TỪ connection (chống spoof) nhưng config thiếu.",
        fix: "Sửa cấu hình connection: thêm brand_id (vd 'givral').", retryable: false,
      });
    }

    if (eventType === "order_completed") {
      const dto = validate(inboundOrderSchema, payload, "order_completed");
      assertIdentifiersValidIfPresent(dto.identifiers, brandId);
      const ev: OrderCompletedEvent = {
        brand_id: brandId,
        store_id: dto.store_id,
        source: dto.source ?? resolved.connectorKey,
        occ_timestamp: dto.occ_timestamp ?? new Date().toISOString(),
        ...(dto.identifiers ? { identifiers: dto.identifiers } : {}),
        properties: dto.properties as OrderCompletedEvent["properties"],
      };
      const result = await ingestOrderCompleted(pool, ev);
      await recordEvent(pool, {
        connectionId: resolved.id, eventType, messageId: result.messageId,
        occId: result.occId, status: "ingested",
      });
      return {
        accepted: true, type: eventType, messageId: result.messageId, occId: result.occId,
        idempotent: result.idempotent, ...(result.mergedOccIds ? { mergedOccIds: result.mergedOccIds } : {}),
      };
    }

    const dto = validate(inboundIdentifySchema, payload, "identify");
    assertIdentifiersValidIfPresent(dto.identifiers, brandId);
    const ev: IdentifyEvent = {
      brand_id: brandId, identifiers: dto.identifiers,
      ...(dto.traits ? { traits: dto.traits as NonNullable<IdentifyEvent["traits"]> } : {}),
    };
    const result = await ingestIdentify(pool, ev);
    await recordEvent(pool, { connectionId: resolved.id, eventType, occId: result.occId, status: "ingested" });
    return { accepted: true, type: eventType, occId: result.occId, mergedOccIds: result.mergedOccIds };
  } catch (err) {
    // Ghi rejected: chỉ mã lỗi (KHÔNG lộ chi tiết/payload). Best-effort — không che lỗi gốc.
    const code = err instanceof AppError ? err.code : "INTERNAL";
    await recordEvent(pool, {
      connectionId: resolved.id, eventType, status: "rejected", error: code,
    }).catch(() => undefined);
    throw err;
  }
}
