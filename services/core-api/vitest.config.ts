import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    // Test integration cần Postgres chạy tuần tự để tránh đụng dữ liệu
    pool: "threads",
  },
});
