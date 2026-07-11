import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./all-exceptions.filter.js";
import { correlationMiddleware } from "./correlation.middleware.js";
// Side-effect: đăng ký adapter connector thật (inbound-pull, outbound...) vào registry.
import "../connector/adapters/register-all.js";

/**
 * Parse TRUST_PROXY: trống/'false' -> null (tắt); 'true' -> true; số nguyên dương -> số hop.
 * Giá trị khác (vd typo 'tru') -> NÉM (fail-fast): tránh âm thầm tắt trust proxy làm sập
 * rate-limit theo IP khi chạy sau proxy.
 */
export function parseTrustProxy(raw: string | undefined): number | boolean | null {
  if (raw === undefined || raw.trim() === "" || raw === "false") return null;
  if (raw === "true") return true;
  const n = Number(raw);
  if (Number.isInteger(n) && n > 0) return n;
  throw new Error(
    `Cấu hình TRUST_PROXY không hợp lệ: '${raw}' (cần 'true', 'false', số hop nguyên dương, hoặc để trống).`,
  );
}

/** Tạo Nest app đã cấu hình (chưa listen) — dùng cho cả bootstrap và e2e test. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  // Trust proxy: để req.ip là IP CLIENT thật (không phải LB/proxy) — cần cho rate-limit
  // route công khai (login) theo IP. TRUST_PROXY = số hop (vd '1') hoặc 'true'; mặc định tắt.
  const trustProxyValue = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxyValue !== null) {
    (app.getHttpAdapter().getInstance() as { set(k: string, v: unknown): void }).set(
      "trust proxy",
      trustProxyValue,
    );
  }
  app.use(correlationMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}
