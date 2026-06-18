import { createHmac, timingSafeEqual } from "node:crypto";

// JWT HS256 tối giản bằng node:crypto (không thêm dep). Đủ cho session admin-console GĐ1.
// Production cân nhắc khóa bất đối xứng (RS256) + rotation nếu cần liên thông nhiều service.

export interface JwtPayload {
  sub: string; // user id
  role: string;
  name: string;
  exp: number; // unix seconds
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function signJwt(
  payload: Omit<JwtPayload, "exp">,
  secret: string,
  ttlSec = 8 * 3600,
): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const body = b64url(Buffer.from(JSON.stringify({ ...payload, exp })));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

/** Trả payload nếu chữ ký hợp lệ và chưa hết hạn; null nếu sai/giả mạo/hết hạn. */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, b, s] = parts as [string, string, string];
  const expected = b64url(createHmac("sha256", secret).update(`${h}.${b}`).digest());
  const sBuf = Buffer.from(s);
  const eBuf = Buffer.from(expected);
  if (sBuf.length !== eBuf.length || !timingSafeEqual(sBuf, eBuf)) return null;
  try {
    // Chống alg-confusion: chỉ chấp nhận HS256/JWT (từ chối alg:none hoặc khác).
    const header = JSON.parse(Buffer.from(h, "base64url").toString()) as {
      alg?: string;
      typ?: string;
    };
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;

    const payload = JSON.parse(Buffer.from(b, "base64url").toString()) as JwtPayload;
    if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) >= payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
