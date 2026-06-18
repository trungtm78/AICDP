import { describe, it, expect } from "vitest";
import { normalizeIdentifier } from "./normalize.js";

describe("normalizeIdentifier — phone (E.164 VN)", () => {
  it("chuyển 0XXXXXXXXX thành +84XXXXXXXXX", () => {
    expect(normalizeIdentifier("phone", "0901234567")).toEqual({
      type: "phone",
      valueNormalized: "+84901234567",
      isStrong: true,
    });
  });

  it("chuyển 84XXXXXXXXX thành +84XXXXXXXXX", () => {
    expect(normalizeIdentifier("phone", "84901234567")?.valueNormalized).toBe(
      "+84901234567",
    );
  });

  it("giữ nguyên +84XXXXXXXXX hợp lệ", () => {
    expect(normalizeIdentifier("phone", "+84901234567")?.valueNormalized).toBe(
      "+84901234567",
    );
  });

  it("bỏ khoảng trắng và ký tự phân tách", () => {
    expect(normalizeIdentifier("phone", "090 123 4567")?.valueNormalized).toBe(
      "+84901234567",
    );
    expect(normalizeIdentifier("phone", "090-123-4567")?.valueNormalized).toBe(
      "+84901234567",
    );
  });

  it("trả null khi đầu số mobile không hợp lệ (không thuộc 3/5/7/8/9)", () => {
    // 0123... -> đầu số 1 không hợp lệ
    expect(normalizeIdentifier("phone", "0123456789")).toBeNull();
  });

  it("trả null khi sai độ dài hoặc chứa chữ", () => {
    expect(normalizeIdentifier("phone", "090123")).toBeNull();
    expect(normalizeIdentifier("phone", "abcxyz")).toBeNull();
    expect(normalizeIdentifier("phone", "")).toBeNull();
  });
});

describe("normalizeIdentifier — email", () => {
  it("trim + lowercase", () => {
    expect(
      normalizeIdentifier("email", "  Test.User@Example.COM ")?.valueNormalized,
    ).toBe("test.user@example.com");
  });

  it("trả null khi email không hợp lệ", () => {
    expect(normalizeIdentifier("email", "not-an-email")).toBeNull();
    expect(normalizeIdentifier("email", "")).toBeNull();
  });
});

describe("normalizeIdentifier — loyalty_card / pos_member_id", () => {
  it("loyalty_card: trim + uppercase", () => {
    expect(normalizeIdentifier("loyalty_card", " gv-001 ")?.valueNormalized).toBe(
      "GV-001",
    );
  });

  it("pos_member_id: scope theo brand", () => {
    expect(
      normalizeIdentifier("pos_member_id", "M123", { brandId: "givral" })
        ?.valueNormalized,
    ).toBe("givral:M123");
  });

  it("pos_member_id: trả null khi thiếu brandId", () => {
    expect(normalizeIdentifier("pos_member_id", "M123")).toBeNull();
  });
});

describe("normalizeIdentifier — anonymous (passthrough)", () => {
  it("web_anonymous_id giữ nguyên", () => {
    const v = "a1b2c3";
    expect(normalizeIdentifier("web_anonymous_id", v)?.valueNormalized).toBe(v);
  });
});

describe("normalizeIdentifier — phân loại mạnh/yếu", () => {
  it("đánh dấu định danh mạnh", () => {
    expect(normalizeIdentifier("phone", "0901234567")?.isStrong).toBe(true);
    expect(normalizeIdentifier("email", "a@b.com")?.isStrong).toBe(true);
  });

  it("đánh dấu định danh yếu", () => {
    expect(normalizeIdentifier("web_anonymous_id", "x")?.isStrong).toBe(false);
  });
});
