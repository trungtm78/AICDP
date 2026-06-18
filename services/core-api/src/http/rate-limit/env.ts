// Tiện ích đọc cấu hình rate-limit từ env — dùng chung cho các guard.

/**
 * Parse env số dương. Trống/không khai báo -> null (TẮT có chủ ý). Khai báo nhưng KHÔNG
 * phải số dương hữu hạn -> NÉM (fail-fast): không âm thầm tắt một control bảo mật.
 */
export function parsePositiveEnv(name: string): number | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `Cấu hình rate-limit không hợp lệ: ${name}='${raw}' (cần số dương hữu hạn, hoặc để trống để tắt).`,
    );
  }
  return n;
}

// Loại bucket idle để chống rò bộ nhớ khi key theo IP (nhiều IP lạ). Mặc định 1 giờ.
export const DEFAULT_MAX_IDLE_MS = 60 * 60 * 1000;

/** maxIdleMs dùng chung (env RATE_LIMIT_MAX_IDLE_MS, fail-fast nếu sai). */
export function readMaxIdleMs(): number {
  return parsePositiveEnv("RATE_LIMIT_MAX_IDLE_MS") ?? DEFAULT_MAX_IDLE_MS;
}
