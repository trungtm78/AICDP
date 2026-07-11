import { verifyHmac } from "../signing.js";

// Xác thực IPN MoMo (v2). signature = HMAC-SHA256(secretKey, rawSignature) với rawSignature là chuỗi
// các field theo THỨ TỰ CỐ ĐỊNH (accessKey&amount&extraData&...&transId). resultCode==0 -> thành công.
// FAIL-CLOSED. Đối chiếu danh sách/thứ tự field với tài liệu MoMo của merchant trước production.

export interface MomoResult {
  ok: boolean;
  merchantId: string; // partnerCode (đã ký) — bind chống replay cross-connection
  txnRef: string;
  amount: number;
  success: boolean;
}

/** Dựng rawSignature MoMo v2 theo thứ tự field chuẩn (accessKey từ config, còn lại từ payload). */
export function buildMomoRaw(accessKey: string, p: Record<string, unknown>): string {
  const g = (k: string): string => String(p[k] ?? "");
  return (
    `accessKey=${accessKey}` +
    `&amount=${g("amount")}` +
    `&extraData=${g("extraData")}` +
    `&message=${g("message")}` +
    `&orderId=${g("orderId")}` +
    `&orderInfo=${g("orderInfo")}` +
    `&orderType=${g("orderType")}` +
    `&partnerCode=${g("partnerCode")}` +
    `&payType=${g("payType")}` +
    `&requestId=${g("requestId")}` +
    `&responseTime=${g("responseTime")}` +
    `&resultCode=${g("resultCode")}` +
    `&transId=${g("transId")}`
  );
}

export function verifyMomo(secret: string, accessKey: string, payload: Record<string, unknown>): MomoResult {
  const provided = typeof payload["signature"] === "string" ? (payload["signature"] as string) : "";
  const ok = provided !== "" && verifyHmac(secret, buildMomoRaw(accessKey, payload), provided, "sha256");
  const txnRef = String(payload["orderId"] ?? "");
  const merchantId = String(payload["partnerCode"] ?? "");
  const amount = Number(payload["amount"]);
  const success = String(payload["resultCode"]) === "0";
  return { ok, merchantId, txnRef, amount, success };
}
