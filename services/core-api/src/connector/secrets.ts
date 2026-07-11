import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "../http/errors.js";

// Mã hoá secret AT-REST cho connection config (API key/token/HashSecret/DB password).
// AES-256-GCM (authenticated): {iv, tag, ct} base64 + hint 4 ký tự cuối để mask UI. Key từ
// CONNECTOR_SECRET_KEY (fail-fast production). Field secret suy từ catalog (configFields.secret).

export interface EncryptedValue {
  __enc: 1;
  v: number; // keyVersion (đỡ cho rotation sau)
  iv: string;
  tag: string;
  ct: string;
  hint: string; // 4 ký tự cuối plaintext (mask "••••1234")
}

export function isEncrypted(v: unknown): v is EncryptedValue {
  return typeof v === "object" && v !== null && (v as { __enc?: unknown }).__enc === 1;
}

function decodeKey(raw: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const b = Buffer.from(raw, "base64");
  return b;
}

/** Key mã hoá secret. Production BẮT BUỘC CONNECTOR_SECRET_KEY (32 byte); dev có key mặc định. */
export function getConnectorSecretKey(): Buffer {
  const env = process.env.CONNECTOR_SECRET_KEY;
  if (env) {
    const key = decodeKey(env);
    if (key.length !== 32) {
      throw new Error("CONNECTOR_SECRET_KEY phải là 32 byte (hex 64 ký tự hoặc base64 32 byte).");
    }
    return key;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("CONNECTOR_SECRET_KEY bắt buộc ở production (32 byte). Đặt biến môi trường trước khi chạy.");
  }
  // eslint-disable-next-line no-console
  console.warn("[connector] CONNECTOR_SECRET_KEY chưa đặt — dùng key DEV (chỉ dev, KHÔNG production).");
  return createHash("sha256").update("occ-cdp-dev-connector-secret-change-me").digest();
}

export function encryptSecret(plain: string, key: Buffer = getConnectorSecretKey()): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __enc: 1,
    v: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
    // Chỉ lưu hint (4 ký tự cuối) khi secret đủ dài (>=8) — tránh lộ phần lớn secret ngắn.
    hint: plain.length >= 8 ? plain.slice(-4) : "",
  };
}

export function decryptSecret(enc: EncryptedValue, key: Buffer = getConnectorSecretKey()): string {
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(enc.iv, "base64"));
    decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(enc.ct, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError({
      code: "SECRET_DECRYPT_FAILED",
      httpStatus: 500,
      message: "Không giải mã được secret của kết nối.",
      why: "Sai CONNECTOR_SECRET_KEY hoặc dữ liệu bị sửa (GCM auth fail).",
      fix: "Kiểm tra CONNECTOR_SECRET_KEY khớp lúc mã hoá; nhập lại credential nếu cần.",
      retryable: false,
    });
  }
}

type Cfg = Record<string, unknown>;

/** Mã hoá các field secret trong config; giữ nguyên field thường; idempotent (field đã mã hoá bỏ qua). */
export function encryptConfig(config: Cfg, secretFields: string[], key: Buffer = getConnectorSecretKey()): Cfg {
  const out: Cfg = { ...config };
  for (const f of secretFields) {
    const val = out[f];
    if (isEncrypted(val)) continue;                 // đã mã hoá -> giữ (re-save không nhập lại secret)
    if (val === null || val === undefined || val === "") continue; // rỗng -> bỏ qua
    if (typeof val === "object") continue;          // object không phải secret hợp lệ -> bỏ qua
    // Coerce MỌI primitive (string/number/boolean) sang string rồi mã hoá — tránh secret
    // dạng non-string lọt qua khâu mã hoá rồi bị maskConfig bỏ sót (rò plaintext ra API).
    out[f] = encryptSecret(String(val), key);
  }
  return out;
}

/** Giải mã mọi field đã mã hoá trong config (dùng khi giao hàng/test — KHÔNG trả ra client). */
export function decryptConfig(config: Cfg, key: Buffer = getConnectorSecretKey()): Cfg {
  const out: Cfg = { ...config };
  for (const [k, v] of Object.entries(out)) {
    if (isEncrypted(v)) out[k] = decryptSecret(v, key);
  }
  return out;
}

/** Che secret cho API đọc: field đã mã hoá -> "••••" + hint; field thường giữ nguyên. */
export function maskConfig(config: Cfg): Cfg {
  const out: Cfg = { ...config };
  for (const [k, v] of Object.entries(out)) {
    if (isEncrypted(v)) out[k] = `••••${v.hint}`;
  }
  return out;
}
