import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { hashPassword, verifyPassword } from "./password.js";
import { signJwt, verifyJwt } from "./jwt.js";

describe("password (scrypt)", () => {
  it("hash rồi verify đúng mật khẩu -> true", () => {
    const h = hashPassword("S3cret!");
    expect(verifyPassword("S3cret!", h)).toBe(true);
  });
  it("sai mật khẩu -> false", () => {
    const h = hashPassword("S3cret!");
    expect(verifyPassword("wrong", h)).toBe(false);
  });
  it("cùng mật khẩu nhưng hash khác nhau (salt ngẫu nhiên)", () => {
    expect(hashPassword("x")).not.toBe(hashPassword("x"));
  });
  it("stored hỏng -> false", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("jwt (HS256)", () => {
  const secret = "test-secret";
  it("sign rồi verify trả payload", () => {
    const t = signJwt({ sub: "u1", role: "admin", name: "A" }, secret);
    const p = verifyJwt(t, secret);
    expect(p?.role).toBe("admin");
    expect(p?.sub).toBe("u1");
  });
  it("sai secret -> null", () => {
    const t = signJwt({ sub: "u1", role: "admin", name: "A" }, secret);
    expect(verifyJwt(t, "other")).toBeNull();
  });
  it("token giả mạo -> null", () => {
    const t = signJwt({ sub: "u1", role: "admin", name: "A" }, secret);
    const tampered = t.slice(0, -3) + "xxx";
    expect(verifyJwt(tampered, secret)).toBeNull();
  });
  it("hết hạn -> null", () => {
    const t = signJwt({ sub: "u1", role: "admin", name: "A" }, secret, -1);
    expect(verifyJwt(t, secret)).toBeNull();
  });

  it("chống alg-confusion: header alg != HS256 -> null (dù chữ ký HMAC đúng)", () => {
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const h = b64({ alg: "none", typ: "JWT" });
    const body = b64({ sub: "u1", role: "admin", name: "A", exp: 9999999999 });
    const sig = createHmac("sha256", secret).update(`${h}.${body}`).digest("base64url");
    expect(verifyJwt(`${h}.${body}.${sig}`, secret)).toBeNull();
  });
});
