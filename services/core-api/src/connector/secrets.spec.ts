import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import { AppError } from "../http/errors.js";
import {
  encryptSecret, decryptSecret, isEncrypted,
  encryptConfig, decryptConfig, maskConfig,
  getConnectorSecretKey,
} from "./secrets.js";

const KEY = randomBytes(32);

describe("secrets · encrypt/decrypt AES-256-GCM", () => {
  it("round-trip đúng plaintext", () => {
    const enc = encryptSecret("super-secret-api-key-1234", KEY);
    expect(isEncrypted(enc)).toBe(true);
    expect(decryptSecret(enc, KEY)).toBe("super-secret-api-key-1234");
  });

  it("KHÔNG deterministic (iv ngẫu nhiên → ciphertext khác nhau)", () => {
    const a = encryptSecret("same", KEY);
    const b = encryptSecret("same", KEY);
    expect(a.ct).not.toBe(b.ct);
    expect(a.iv).not.toBe(b.iv);
  });

  it("sai key -> SECRET_DECRYPT_FAILED", () => {
    const enc = encryptSecret("x", KEY);
    expect(() => decryptSecret(enc, randomBytes(32))).toThrow(AppError);
    try { decryptSecret(enc, randomBytes(32)); } catch (e) { expect((e as AppError).code).toBe("SECRET_DECRYPT_FAILED"); }
  });

  it("ciphertext bị sửa (tamper) -> GCM authTag fail -> SECRET_DECRYPT_FAILED", () => {
    const enc = encryptSecret("x", KEY);
    const tampered = { ...enc, ct: Buffer.from("deadbeef").toString("base64") };
    expect(() => decryptSecret(tampered, KEY)).toThrow(AppError);
  });

  it("lưu hint 4 ký tự cuối để mask, KHÔNG lộ toàn bộ", () => {
    const enc = encryptSecret("abcd1234", KEY);
    expect(enc.hint).toBe("1234");
    expect(JSON.stringify(enc)).not.toContain("abcd1234");
  });
});

describe("secrets · config-level", () => {
  const cfg = { apiKey: "sk_live_abcd9999", oaId: "oa-123", webhookUrl: "https://x.test/h" };

  it("encryptConfig chỉ mã hoá field secret, giữ nguyên field thường", () => {
    const enc = encryptConfig(cfg, ["apiKey"], KEY);
    expect(isEncrypted(enc.apiKey)).toBe(true);
    expect(enc.oaId).toBe("oa-123");
    expect(enc.webhookUrl).toBe("https://x.test/h");
  });

  it("decryptConfig khôi phục đúng", () => {
    const enc = encryptConfig(cfg, ["apiKey"], KEY);
    const dec = decryptConfig(enc, KEY);
    expect(dec.apiKey).toBe("sk_live_abcd9999");
  });

  it("maskConfig che secret (••••+hint), field thường giữ nguyên", () => {
    const enc = encryptConfig(cfg, ["apiKey"], KEY);
    const masked = maskConfig(enc);
    expect(masked.apiKey).toBe("••••9999");
    expect(masked.oaId).toBe("oa-123");
    expect(JSON.stringify(masked)).not.toContain("sk_live");
  });

  it("encryptConfig idempotent: field đã mã hoá không mã hoá lại (giữ khi re-save không nhập lại secret)", () => {
    const enc1 = encryptConfig(cfg, ["apiKey"], KEY);
    const enc2 = encryptConfig(enc1, ["apiKey"], KEY);
    expect(enc2.apiKey).toEqual(enc1.apiKey);
  });

  it("bỏ qua field secret rỗng/không tồn tại", () => {
    const enc = encryptConfig({ apiKey: "" }, ["apiKey", "missing"], KEY);
    expect(enc.apiKey).toBe("");
  });

  it("secret NON-STRING (number) vẫn được mã hoá (không lọt plaintext qua maskConfig)", () => {
    const enc = encryptConfig({ pin: 12345678 }, ["pin"], KEY);
    expect(isEncrypted(enc.pin)).toBe(true);
    expect(decryptSecret(enc.pin as never, KEY)).toBe("12345678");
    const masked = maskConfig(enc);
    expect(masked.pin).toBe("••••5678");
    expect(JSON.stringify(masked)).not.toContain("12345678");
  });
});

describe("secrets · getConnectorSecretKey", () => {
  const saved = process.env.CONNECTOR_SECRET_KEY;
  const savedEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (saved === undefined) delete process.env.CONNECTOR_SECRET_KEY; else process.env.CONNECTOR_SECRET_KEY = saved;
    process.env.NODE_ENV = savedEnv;
  });

  it("đọc key hex 64 ký tự -> 32 byte", () => {
    process.env.CONNECTOR_SECRET_KEY = "a".repeat(64);
    expect(getConnectorSecretKey().length).toBe(32);
  });

  it("đọc key base64 32 byte", () => {
    process.env.CONNECTOR_SECRET_KEY = randomBytes(32).toString("base64");
    expect(getConnectorSecretKey().length).toBe(32);
  });

  it("production + thiếu key -> fail-fast", () => {
    delete process.env.CONNECTOR_SECRET_KEY;
    process.env.NODE_ENV = "production";
    expect(() => getConnectorSecretKey()).toThrow();
  });

  it("dev + thiếu key -> key dev 32 byte (không throw)", () => {
    delete process.env.CONNECTOR_SECRET_KEY;
    process.env.NODE_ENV = "test";
    expect(getConnectorSecretKey().length).toBe(32);
  });
});
