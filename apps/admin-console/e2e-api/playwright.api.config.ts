import { defineConfig } from "@playwright/test";

// API smoke gate — chạy TRƯỚC UI E2E (theo quy trình UAT 2 lớp).
// Test trực tiếp core-api :8071 (bind 0.0.0.0 -> dùng 127.0.0.1). KHÔNG dùng storageState/UI.
// Mỗi case dùng token đúng role (tạo user qua admin trong setup) để verify RBAC deny-by-default.
export default defineConfig({
  testDir: ".",
  testMatch: "system.api.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8071",
    extraHTTPHeaders: { "Content-Type": "application/json" },
    trace: "retain-on-failure",
  },
  projects: [{ name: "api" }],
});
