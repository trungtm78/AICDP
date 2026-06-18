import { defineConfig, devices } from "@playwright/test";

// E2E thật qua Chromium click trên UI (DESIGN.md). Yêu cầu core-api :8071 + dev :8073
// đang chạy. Dùng localhost (Vite bind ::1). KHÔNG seed data qua API — chỉ thao tác UI.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:8073",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
