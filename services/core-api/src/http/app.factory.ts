import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./all-exceptions.filter.js";
import { correlationMiddleware } from "./correlation.middleware.js";

/** Tạo Nest app đã cấu hình (chưa listen) — dùng cho cả bootstrap và e2e test. */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.use(correlationMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  return app;
}
