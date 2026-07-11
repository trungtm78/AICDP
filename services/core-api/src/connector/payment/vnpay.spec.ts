import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { buildVnpayHashData, verifyVnpay } from "./vnpay.js";

// VNPay IPN: chữ ký vnp_SecureHash = HMAC-SHA512(secretKey, hashData) với hashData = các tham số
// vnp_* (trừ vnp_SecureHash/HashType) sắp xếp theo key + urlencode value. Test tự tính chữ ký
// hợp lệ (đúng cách VNPay ký) rồi kiểm verify chấp nhận + phát hiện giả mạo.

const SECRET = "OCCVNPAYSECRET123";
const base: Record<string, string> = {
  vnp_TxnRef: "PAY-001",
  vnp_Amount: "25000000", // 250.000 VND ×100
  vnp_ResponseCode: "00",
  vnp_BankCode: "NCB",
  vnp_TransactionStatus: "00",
};
function sign(params: Record<string, string>, secret = SECRET): string {
  return createHmac("sha512", secret).update(buildVnpayHashData(params), "utf8").digest("hex");
}

describe("verifyVnpay", () => {
  it("chữ ký hợp lệ -> ok, trả txnRef + amount(VND) + success", () => {
    const params = { ...base, vnp_SecureHash: sign(base) };
    const r = verifyVnpay(SECRET, params);
    expect(r.ok).toBe(true);
    expect(r.txnRef).toBe("PAY-001");
    expect(r.amount).toBe(250000); // /100
    expect(r.success).toBe(true);
  });

  it("giả mạo amount sau khi ký -> chữ ký sai -> ok=false (fail-closed)", () => {
    const params = { ...base, vnp_SecureHash: sign(base), vnp_Amount: "1" };
    expect(verifyVnpay(SECRET, params).ok).toBe(false);
  });

  it("sai secret -> ok=false", () => {
    const params = { ...base, vnp_SecureHash: sign(base, "WRONG") };
    expect(verifyVnpay(SECRET, params).ok).toBe(false);
  });

  it("thiếu vnp_SecureHash -> ok=false", () => {
    expect(verifyVnpay(SECRET, { ...base }).ok).toBe(false);
  });

  it("ResponseCode != 00 -> ok(chữ ký đúng) nhưng success=false", () => {
    const failed = { ...base, vnp_ResponseCode: "24", vnp_TransactionStatus: "02" };
    const params = { ...failed, vnp_SecureHash: sign(failed) };
    const r = verifyVnpay(SECRET, params);
    expect(r.ok).toBe(true);
    expect(r.success).toBe(false);
  });

  it("hashData KHÔNG chứa vnp_SecureHash/vnp_SecureHashType (loại trừ đúng)", () => {
    const hd = buildVnpayHashData({ ...base, vnp_SecureHash: "x", vnp_SecureHashType: "SHA512" });
    expect(hd).not.toContain("vnp_SecureHash");
    // sắp xếp theo key: vnp_Amount đứng trước vnp_BankCode
    expect(hd.indexOf("vnp_Amount")).toBeLessThan(hd.indexOf("vnp_BankCode"));
  });
});
