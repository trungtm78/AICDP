import { createHmac, timingSafeEqual } from "node:crypto";

// Ký/verify HMAC + so sánh constant-time — dùng cho IPN thanh toán (VNPay SHA512, MoMo/ZaloPay
// SHA256), chữ ký webhook outbound (X-OCC-Signature), và so token inbound. LUÔN so constant-time.

export function hmacHex(secret: string, data: string, algo: "sha256" | "sha512" = "sha256"): string {
  return createHmac(algo, secret).update(data, "utf8").digest("hex");
}

/** So sánh 2 chuỗi theo thời-gian-hằng (chống timing attack). Khác độ dài -> false. */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** Verify HMAC hex (không phân biệt hoa/thường ở chữ ký mong đợi), constant-time. */
export function verifyHmac(
  secret: string,
  data: string,
  expectedHex: string,
  algo: "sha256" | "sha512" = "sha256",
): boolean {
  return timingSafeEqualStr(hmacHex(secret, data, algo), expectedHex.trim().toLowerCase());
}
