import type { Pool } from "pg";
import { AppError } from "../../http/errors.js";
import { decryptConfig } from "../secrets.js";
import { recordEvent } from "../logs.service.js";
import { ingestOrderCompleted, type OrderCompletedEvent } from "../../ingestion/ingestion.service.js";
import { verifyVnpay } from "./vnpay.js";

// Xử lý IPN cổng thanh toán (VNPay/MoMo/ZaloPay). BẢO MẬT (threat-model P0 "IPN-checksum"):
// - Verify chữ ký/checksum TRƯỚC, FAIL-CLOSED (chữ ký sai -> KHÔNG ingest, trả mã lỗi cổng).
// - brand_id + store_id + secret lấy TỪ connection (chống spoof). KHÔNG tin field client cho brand.
// - Chống replay: message_id = {brand}:{store}:{txnRef} unique -> ingestOrderCompleted idempotent.
// - Amount lấy từ payload ĐÃ KÝ (chữ ký phủ amount) -> tin cậy; NaN -> từ chối (không ingest 0).

/** Body ACK trả về cổng (định dạng theo từng cổng). */
export type IpnAck = Record<string, unknown>;

const GATEWAY_BY_KEY: Record<string, "vnpay" | "momo" | "zalopay"> = {
  src_vnpay: "vnpay",
  src_momo: "momo",
  src_zalopay: "zalopay",
};

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

function misconfigured(msg: string): AppError {
  return new AppError({
    code: "CONNECTOR_MISCONFIGURED", httpStatus: 400, message: msg,
    why: "Cấu hình cổng thanh toán chưa hợp lệ.", fix: "Kiểm tra connector/secretKey/brand_id.", retryable: false,
  });
}

export async function processPaymentIpn(
  pool: Pool,
  connectionId: string,
  payload: Record<string, unknown>,
): Promise<IpnAck> {
  const r = await pool.query<{
    direction: string; status: string; connector_key: string; config: Record<string, unknown>;
  }>(`SELECT direction, status, connector_key, config FROM cdp.connection WHERE id=$1`, [connectionId]);
  const row = r.rows[0];
  if (!row) {
    throw new AppError({
      code: "NOT_FOUND", httpStatus: 404, message: "Không tìm thấy kết nối thanh toán.",
      why: "id không tồn tại.", fix: "Kiểm tra lại id cổng IPN.", retryable: false,
    });
  }
  const gateway = GATEWAY_BY_KEY[row.connector_key];
  if (!gateway) throw misconfigured(`Connector '${row.connector_key}' không phải cổng thanh toán.`);
  if (row.direction !== "source" || row.status !== "active") {
    throw misconfigured("Kết nối thanh toán phải là source đang active.");
  }

  const config = decryptConfig(row.config ?? {});
  const secret = str(config["secretKey"]);
  const brandId = str(config["brand_id"]) ?? str(config["brandId"]);
  if (!secret) throw misconfigured("Kết nối chưa cấu hình secretKey (khoá checksum).");
  if (!brandId) throw misconfigured("Kết nối chưa gắn brand_id.");
  const storeId = str(config["store_id"]) ?? gateway;

  if (gateway === "vnpay") {
    return handleVnpay(pool, connectionId, secret, brandId, storeId, payload);
  }
  // MoMo/ZaloPay: Task 3.2.
  throw new AppError({
    code: "INTEGRATION_NOT_AVAILABLE", httpStatus: 400,
    message: `Cổng '${gateway}' chưa hỗ trợ IPN.`, why: "Adapter IPN chưa cài.",
    fix: "Chờ Task 3.2 (MoMo/ZaloPay).", retryable: false,
  });
}

async function handleVnpay(
  pool: Pool, connectionId: string, secret: string, brandId: string, storeId: string,
  payload: Record<string, unknown>,
): Promise<IpnAck> {
  const v = verifyVnpay(secret, payload);
  if (!v.ok) {
    await recordEvent(pool, { connectionId, eventType: "payment", status: "rejected", error: "IPN_CHECKSUM_INVALID" });
    return { RspCode: "97", Message: "Invalid Checksum" };
  }
  if (!v.txnRef) {
    await recordEvent(pool, { connectionId, eventType: "payment", status: "rejected", error: "MISSING_TXN_REF" });
    return { RspCode: "01", Message: "Order not found" };
  }
  if (!v.success) {
    // Chữ ký đúng nhưng giao dịch không thành công -> đã nhận (không retry), KHÔNG ingest.
    await recordEvent(pool, { connectionId, eventType: "payment", messageId: v.txnRef, status: "rejected", error: "PAYMENT_NOT_SUCCESS" });
    return { RspCode: "00", Message: "Confirm Received" };
  }
  if (!Number.isFinite(v.amount) || v.amount <= 0) {
    await recordEvent(pool, { connectionId, eventType: "payment", messageId: v.txnRef, status: "rejected", error: "INVALID_AMOUNT" });
    return { RspCode: "04", Message: "Invalid Amount" };
  }

  const ev: OrderCompletedEvent = {
    brand_id: brandId, store_id: storeId, source: "vnpay",
    occ_timestamp: new Date().toISOString(),
    properties: { pos_transaction_id: v.txnRef, currency: "VND", total: v.amount, payment_method: "vnpay" },
  };
  const res = await ingestOrderCompleted(pool, ev);
  await recordEvent(pool, {
    connectionId, eventType: "payment", messageId: res.messageId, occId: res.occId, status: "ingested",
  });
  return { RspCode: "00", Message: res.idempotent ? "Order Already Confirmed" : "Confirm Success" };
}
