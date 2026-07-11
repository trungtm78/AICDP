import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { buildMomoRaw, verifyMomo } from "./momo.js";
import { verifyZalopay } from "./zalopay.js";

const hmac256 = (key: string, data: string) => createHmac("sha256", key).update(data, "utf8").digest("hex");

describe("verifyMomo", () => {
  const SECRET = "MOMOSECRET";
  const ACCESS = "MOMOACCESS";
  const base: Record<string, string> = {
    partnerCode: "OCC", orderId: "MM-1", requestId: "R1", amount: "150000",
    orderInfo: "thanh toan", orderType: "momo_wallet", transId: "T1", resultCode: "0",
    message: "success", payType: "qr", responseTime: "1700000000000", extraData: "",
  };
  const withSig = (p: Record<string, string>) => ({ ...p, signature: hmac256(SECRET, buildMomoRaw(ACCESS, p)) });

  it("chữ ký hợp lệ + resultCode 0 -> ok + success, txnRef=orderId, amount", () => {
    const r = verifyMomo(SECRET, ACCESS, withSig(base));
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(r.txnRef).toBe("MM-1");
    expect(r.amount).toBe(150000);
  });

  it("giả mạo amount sau khi ký -> ok=false", () => {
    const signed = withSig(base);
    expect(verifyMomo(SECRET, ACCESS, { ...signed, amount: "1" }).ok).toBe(false);
  });

  it("resultCode != 0 -> success=false (dù chữ ký đúng)", () => {
    const failed = { ...base, resultCode: "1006" };
    expect(verifyMomo(SECRET, ACCESS, withSig(failed)).success).toBe(false);
  });

  it("sai accessKey -> ok=false", () => {
    expect(verifyMomo(SECRET, "WRONG", withSig(base)).ok).toBe(false);
  });
});

describe("verifyZalopay", () => {
  const KEY2 = "ZALOKEY2";
  const data = JSON.stringify({ app_trans_id: "ZP-1", amount: 250000, app_time: 1700000000000 });

  it("mac hợp lệ -> ok + success, parse app_trans_id + amount", () => {
    const r = verifyZalopay(KEY2, { data, mac: hmac256(KEY2, data) });
    expect(r.ok).toBe(true);
    expect(r.success).toBe(true);
    expect(r.txnRef).toBe("ZP-1");
    expect(r.amount).toBe(250000);
  });

  it("giả mạo data -> mac sai -> ok=false", () => {
    const tampered = JSON.stringify({ app_trans_id: "ZP-1", amount: 1 });
    expect(verifyZalopay(KEY2, { data: tampered, mac: hmac256(KEY2, data) }).ok).toBe(false);
  });

  it("thiếu mac -> ok=false", () => {
    expect(verifyZalopay(KEY2, { data }).ok).toBe(false);
  });

  it("data không phải JSON -> ok theo mac nhưng txnRef rỗng", () => {
    const bad = "not-json";
    const r = verifyZalopay(KEY2, { data: bad, mac: hmac256(KEY2, bad) });
    expect(r.ok).toBe(true);
    expect(r.txnRef).toBe("");
  });
});
