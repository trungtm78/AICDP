import { createCh, type Ch } from "../clickhouse/client.js";
import { ensureClickhouseSchema } from "../clickhouse/schema.js";

// Helper test cho ClickHouse. Test CH chỉ chạy khi CH KẾT NỐI ĐƯỢC (chReachable) — nếu không
// (vd Docker chưa lên), spec tự skip để suite vẫn xanh; tự chạy lại khi CH sẵn sàng.

let client: Ch | null = null;
export function testCh(): Ch {
  if (!client) client = createCh({ requestTimeoutMs: 4000 });
  return client;
}

/** Kiểm tra nhanh CH có kết nối được không (timeout ngắn) — quyết định skip test. */
export async function chReachable(): Promise<boolean> {
  try {
    const probe = createCh({ requestTimeoutMs: 2000 });
    const res = await probe.ping();
    await probe.close();
    return res.success === true;
  } catch {
    return false;
  }
}

export async function setupTestCh(): Promise<void> {
  await ensureClickhouseSchema(testCh());
}

export async function truncateCh(): Promise<void> {
  await testCh().command({ query: "TRUNCATE TABLE IF EXISTS transactions" });
}
