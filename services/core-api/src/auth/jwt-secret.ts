// Bí mật ký JWT. Production BẮT BUỘC đặt CORE_API_JWT_SECRET (random mạnh). Dev có default
// kèm cảnh báo. Đọc lười + cache để guard và service dùng cùng giá trị.
let cached: string | null = null;

export function getJwtSecret(): string {
  if (cached) return cached;
  const env = process.env.CORE_API_JWT_SECRET;
  if (env && env.length >= 16) {
    cached = env;
    return cached;
  }
  // Production: BẮT BUỘC có secret mạnh — fail fast, KHÔNG dùng default (chống forge JWT admin).
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CORE_API_JWT_SECRET bắt buộc ở production (>=16 ký tự). Đặt biến môi trường trước khi chạy.",
    );
  }
  cached = "occ-cdp-dev-jwt-secret-change-me";
  // eslint-disable-next-line no-console
  console.warn("[auth] CORE_API_JWT_SECRET chưa đặt — dùng secret DEV (chỉ dev, KHÔNG production).");
  return cached;
}
