import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  // SWC để compile decorator + emitDecoratorMetadata cho NestJS (esbuild không hỗ trợ metadata).
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: {
        target: "es2022",
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts"],
    setupFiles: ["./src/test-helpers/vitest.setup.ts"],
    // Các file test chia sẻ chung một Postgres (AI_CDP_Pro) -> chạy TUẦN TỰ
    // để truncate giữa các test không đụng dữ liệu của file khác.
    fileParallelism: false,
  },
});
