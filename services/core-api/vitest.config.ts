import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // Các file test chia sẻ chung một Postgres (AI_CDP_Pro) -> chạy TUẦN TỰ
    // để truncate giữa các test không đụng dữ liệu của file khác.
    fileParallelism: false,
  },
});
