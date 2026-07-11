import { verifyHmac } from "../signing.js";

// Xác thực callback ZaloPay. Body {data, mac, type}. mac = HMAC-SHA256(key2, data) hex. data là
// chuỗi JSON chứa app_trans_id, amount, app_time... ZaloPay CHỈ gọi callback khi thanh toán thành
// công (type=1) -> success = chữ ký hợp lệ. FAIL-CLOSED. Đối chiếu format với tài liệu ZaloPay.

export interface ZalopayResult {
  ok: boolean;
  txnRef: string;
  amount: number;
  success: boolean;
}

export function verifyZalopay(key2: string, payload: Record<string, unknown>): ZalopayResult {
  const data = typeof payload["data"] === "string" ? (payload["data"] as string) : "";
  const mac = typeof payload["mac"] === "string" ? (payload["mac"] as string) : "";
  const ok = data !== "" && mac !== "" && verifyHmac(key2, data, mac, "sha256");
  let txnRef = "";
  let amount = NaN;
  if (ok) {
    try {
      const d = JSON.parse(data) as Record<string, unknown>;
      txnRef = String(d["app_trans_id"] ?? d["apptransid"] ?? "");
      amount = Number(d["amount"]);
    } catch {
      // data không phải JSON hợp lệ -> coi như không có txnRef -> caller trả lỗi.
    }
  }
  return { ok, txnRef, amount, success: ok };
}
