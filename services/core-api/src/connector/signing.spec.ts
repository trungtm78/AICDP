import { describe, it, expect } from "vitest";
import { hmacHex, timingSafeEqualStr, verifyHmac } from "./signing.js";

describe("signing · hmac", () => {
  it("hmacHex sha256 khớp known vector", () => {
    // HMAC-SHA256(key='key', msg='The quick brown fox jumps over the lazy dog')
    expect(hmacHex("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
  it("hmacHex sha512 dài 128 hex", () => {
    expect(hmacHex("k", "d", "sha512")).toHaveLength(128);
  });
  it("verifyHmac true khi đúng, false khi sai; không phân biệt hoa/thường chữ ký mong đợi", () => {
    const sig = hmacHex("secret", "payload");
    expect(verifyHmac("secret", "payload", sig)).toBe(true);
    expect(verifyHmac("secret", "payload", sig.toUpperCase())).toBe(true);
    expect(verifyHmac("secret", "payload", "deadbeef")).toBe(false);
    expect(verifyHmac("wrong", "payload", sig)).toBe(false);
  });
});

describe("signing · timingSafeEqualStr", () => {
  it("bằng -> true", () => {
    expect(timingSafeEqualStr("abc123", "abc123")).toBe(true);
  });
  it("khác độ dài -> false (không throw)", () => {
    expect(timingSafeEqualStr("abc", "abcd")).toBe(false);
  });
  it("cùng độ dài khác nội dung -> false", () => {
    expect(timingSafeEqualStr("aaaa", "aaab")).toBe(false);
  });
});
