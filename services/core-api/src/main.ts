import "reflect-metadata";
import { createApp } from "./http/app.factory.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";

const PORT = Number(process.env.CORE_API_PORT ?? 8071);

async function bootstrap(): Promise<void> {
  // Đảm bảo schema sẵn sàng trước khi nhận request (migration idempotent).
  await runMigrations(pool);
  const app = await createApp();
  await app.listen(PORT, "0.0.0.0");
  // eslint-disable-next-line no-console
  console.log(`core-api đang chạy tại http://localhost:${PORT}/v1`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Khởi động core-api thất bại:", err);
  process.exit(1);
});
