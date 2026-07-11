import type { Pool } from "pg";
import { AppError } from "../../http/errors.js";
import { decryptConfig } from "../secrets.js";
import { recordEvent } from "../logs.service.js";
import { ingestOrderCompleted, type OrderCompletedEvent } from "../../ingestion/ingestion.service.js";
import { verifyVnpay } from "./vnpay.js";
import { verifyMomo } from "./momo.js";
import { verifyZalopay } from "./zalopay.js";
import { checkInboundRate } from "../connector-inbound-ratelimit.js";

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
// txnRef an toàn: alnum + . _ - , 1..100 ký tự (KHÔNG chứa ':' delimiter message_id).
const SAFE_TXN_REF = /^[A-Za-z0-9._-]{1,100}$/;
// Ngưỡng amount VND: 100 tỷ — dư cho mọi giao dịch F&B/khách sạn, dưới xa 2^53 (chống precision).
const MAX_AMOUNT_VND = 100_000_000_000;
const isPrintable = (s: string): boolean => s.length <= 200 && !/[\x00-\x1f]/.test(s);

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
  const expectedMerchant = str(config["merchantId"]);
  if (!secret) throw misconfigured("Kết nối chưa cấu hình secretKey (khoá checksum).");
  if (!brandId) throw misconfigured("Kết nối chưa gắn brand_id.");
  if (!expectedMerchant) throw misconfigured("Kết nối chưa cấu hình merchantId (vnp_TmnCode/partnerCode/app_id).");
  const storeId = str(config["store_id"]) ?? gateway;

  // Verify chữ ký theo cổng -> kết quả chuẩn hoá {ok,merchantId,txnRef,amount,success}.
  let v: PaymentVerify;
  if (gateway === "vnpay") v = verifyVnpay(secret, payload);
  else if (gateway === "zalopay") v = verifyZalopay(secret, payload);
  else {
    const accessKey = str(config["accessKey"]);
    if (!accessKey) throw misconfigured("Kết nối MoMo chưa cấu hình accessKey.");
    v = verifyMomo(secret, accessKey, payload);
  }

  // Sau khi chữ ký hợp lệ: (1) BIND merchant đã ký == merchantId của connection -> chống replay
  // cross-connection khi secret dùng chung (multi-brand cùng tài khoản gateway); (2) rate-limit
  // per-connection CHỈ tính request hợp lệ -> flood sai-checksum KHÔNG đốt quota IPN thật.
  if (v.ok) {
    if (v.merchantId !== expectedMerchant) {
      await recordEvent(pool, { connectionId, eventType: "payment", status: "rejected", error: "MERCHANT_MISMATCH" });
      return ackFor(gateway, "bad_checksum");
    }
    const rl = checkInboundRate(connectionId);
    if (!rl.allowed) {
      throw new AppError({
        code: "CONNECTOR_RATE_LIMIT", httpStatus: 429, message: "Vượt giới hạn tần suất IPN.",
        why: "Connection nhận quá nhiều IPN hợp lệ trong thời gian ngắn.",
        fix: `Thử lại sau ${rl.retryAfterSec}s.`, retryable: true,
      });
    }
  }

  const verdict = await ingestVerified(pool, connectionId, brandId, storeId, gateway, v);
  return ackFor(gateway, verdict);
}

/** Kết quả verify chuẩn hoá cho mọi cổng. */
export interface PaymentVerify {
  ok: boolean; // chữ ký hợp lệ
  merchantId: string; // định danh merchant ĐÃ KÝ (vnp_TmnCode/partnerCode/app_id)
  txnRef: string;
  amount: number; // VND
  success: boolean; // giao dịch thành công
}

type PayVerdict =
  | "bad_checksum" | "no_txnref" | "not_success" | "bad_amount" | "ingested" | "idempotent";

/** Lõi chung: kiểm chữ ký/txnRef/success/amount -> ingest (idempotent) -> ghi event. FAIL-CLOSED. */
async function ingestVerified(
  pool: Pool, connectionId: string, brandId: string, storeId: string,
  gateway: string, v: PaymentVerify,
): Promise<PayVerdict> {
  const rej = (error: string, messageId?: string): Promise<void> =>
    recordEvent(pool, { connectionId, eventType: "payment", status: "rejected", error, ...(messageId ? { messageId } : {}) });

  if (!v.ok) { await rej("IPN_CHECKSUM_INVALID"); return "bad_checksum"; }
  // txnRef phải sạch: ':' là delimiter message_id {brand}:{store}:{txnRef} -> chặn để không bẩn
  // namespace/khoá idempotency; cũng cap độ dài + ký tự (gateway dùng alnum/._-).
  if (!SAFE_TXN_REF.test(v.txnRef)) { await rej("MISSING_TXN_REF", isPrintable(v.txnRef) ? v.txnRef : undefined); return "no_txnref"; }
  if (!v.success) { await rej("PAYMENT_NOT_SUCCESS", v.txnRef); return "not_success"; }
  // amount: SỐ NGUYÊN an toàn (VND không phần lẻ), >0, trong ngưỡng (chống "100.5"/"1e2"/precision>2^53).
  if (!Number.isSafeInteger(v.amount) || v.amount <= 0 || v.amount > MAX_AMOUNT_VND) {
    await rej("INVALID_AMOUNT", v.txnRef); return "bad_amount";
  }

  const ev: OrderCompletedEvent = {
    brand_id: brandId, store_id: storeId, source: gateway,
    occ_timestamp: new Date().toISOString(),
    properties: { pos_transaction_id: v.txnRef, currency: "VND", total: v.amount, payment_method: gateway },
  };
  const res = await ingestOrderCompleted(pool, ev);
  await recordEvent(pool, { connectionId, eventType: "payment", messageId: res.messageId, occId: res.occId, status: "ingested" });
  return res.idempotent ? "idempotent" : "ingested";
}

/** ACK theo định dạng riêng của từng cổng (cổng đọc mã này để dừng retry / báo lỗi). */
function ackFor(gateway: "vnpay" | "momo" | "zalopay", verdict: PayVerdict): IpnAck {
  if (gateway === "vnpay") {
    switch (verdict) {
      case "bad_checksum": return { RspCode: "97", Message: "Invalid Checksum" };
      case "no_txnref": return { RspCode: "01", Message: "Order not found" };
      case "not_success": return { RspCode: "00", Message: "Confirm Received" };
      case "bad_amount": return { RspCode: "04", Message: "Invalid Amount" };
      case "idempotent": return { RspCode: "00", Message: "Order Already Confirmed" };
      default: return { RspCode: "00", Message: "Confirm Success" };
    }
  }
  if (gateway === "zalopay") {
    if (verdict === "bad_checksum") return { return_code: -1, return_message: "mac not equal" };
    if (verdict === "ingested" || verdict === "idempotent") return { return_code: 1, return_message: "success" };
    return { return_code: 0, return_message: "retry" }; // ZaloPay sẽ gọi lại sau
  }
  // momo: resultCode 0 = đã nhận OK; != 0 = lỗi (MoMo chủ yếu chỉ cần HTTP 2xx).
  if (verdict === "bad_checksum") return { resultCode: 1, message: "Invalid signature" };
  return { resultCode: 0, message: "received" };
}
