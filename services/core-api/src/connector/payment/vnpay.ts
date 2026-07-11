import { verifyHmac } from "../signing.js";

// Xác thực IPN VNPay (v2.1.x). hashData = các tham số vnp_* (TRỪ vnp_SecureHash & vnp_SecureHashType)
// sắp xếp theo tên key tăng dần, mỗi cặp `key=urlencode(value)` nối bằng '&'. Chữ ký =
// HMAC-SHA512(vnp_HashSecret, hashData) hex. So constant-time (verifyHmac). FAIL-CLOSED.
// LƯU Ý: đối chiếu định dạng encode với tài liệu VNPay của merchant trước production.

export interface VnpayResult {
  ok: boolean; // chữ ký hợp lệ
  merchantId: string; // vnp_TmnCode (định danh merchant ĐÃ KÝ — bind chống replay cross-connection)
  txnRef: string; // vnp_TxnRef (mã đơn merchant)
  amount: number; // VND (đã /100)
  success: boolean; // giao dịch thành công (vnp_ResponseCode == '00' && TransactionStatus == '00')
}

/** Dựng chuỗi hashData chuẩn VNPay từ params (loại vnp_SecureHash*, sort key, urlencode value). */
export function buildVnpayHashData(params: Record<string, unknown>): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "vnp_SecureHash" && k !== "vnp_SecureHashType" && k.startsWith("vnp_"))
    .sort();
  return keys.map((k) => `${k}=${encodeURIComponent(String(params[k] ?? ""))}`).join("&");
}

export function verifyVnpay(secret: string, params: Record<string, unknown>): VnpayResult {
  const provided = typeof params["vnp_SecureHash"] === "string" ? (params["vnp_SecureHash"] as string) : "";
  const ok = provided !== "" && verifyHmac(secret, buildVnpayHashData(params), provided, "sha512");
  const txnRef = typeof params["vnp_TxnRef"] === "string" ? (params["vnp_TxnRef"] as string) : "";
  const merchantId = typeof params["vnp_TmnCode"] === "string" ? (params["vnp_TmnCode"] as string) : "";
  const amountRaw = Number(params["vnp_Amount"]);
  const amount = Number.isFinite(amountRaw) ? amountRaw / 100 : NaN;
  const success = params["vnp_ResponseCode"] === "00" && params["vnp_TransactionStatus"] === "00";
  return { ok, merchantId, txnRef, amount, success };
}
