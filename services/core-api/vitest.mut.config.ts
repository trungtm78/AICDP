import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

// Config riêng cho mutation testing (Stryker): CHỈ chạy test thuần (không DB) phủ normalize.ts
// -> mỗi mutant chạy cực nhanh, không phụ thuộc Postgres.
export default defineConfig({
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
    include: ["src/expert/normalize.prop.spec.ts", "src/identity/normalize.spec.ts"],
    fileParallelism: false,
  },
});
