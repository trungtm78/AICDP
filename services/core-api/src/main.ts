import "reflect-metadata";
import { createApp } from "./http/app.factory.js";
import { runMigrations } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { sharedCh } from "./clickhouse/client.js";
import { ensureClickhouseSchema } from "./clickhouse/schema.js";

const PORT = Number(process.env.CORE_API_PORT ?? 8071);

async function bootstrap(): Promise<void> {
  // Đảm bảo schema sẵn sàng trước khi nhận request (migration idempotent).
  await runMigrations(pool);
  // Schema ClickHouse (OLAP) best-effort: CH down KHÔNG chặn khởi động (PG là SoR).
  try {
    await ensureClickhouseSchema(sharedCh());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[bootstrap] Bỏ qua schema ClickHouse (không sẵn sàng):", (err as Error).message);
  }
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
