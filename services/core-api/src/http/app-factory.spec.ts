import { describe, it, expect } from "vitest";
import { parseTrustProxy } from "./app.factory.js";

describe("parseTrustProxy (fail-fast cấu hình proxy)", () => {
  it("trống / undefined / 'false' -> null (tắt)", () => {
    expect(parseTrustProxy(undefined)).toBeNull();
    expect(parseTrustProxy("")).toBeNull();
    expect(parseTrustProxy("   ")).toBeNull();
    expect(parseTrustProxy("false")).toBeNull();
  });

  it("'true' -> true", () => {
    expect(parseTrustProxy("true")).toBe(true);
  });

  it("số nguyên dương -> số hop", () => {
    expect(parseTrustProxy("1")).toBe(1);
    expect(parseTrustProxy("2")).toBe(2);
  });

  it("giá trị sai (typo, 0, âm, thập phân) -> NÉM (không âm thầm tắt)", () => {
    expect(() => parseTrustProxy("tru")).toThrow();
    expect(() => parseTrustProxy("0")).toThrow();
    expect(() => parseTrustProxy("-1")).toThrow();
    expect(() => parseTrustProxy("1.5")).toThrow();
  });
});
