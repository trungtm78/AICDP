/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// admin-console: dev tại :8073, proxy /v1 -> core-api :8071 (127.0.0.1 tránh IPv6 ::1).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 8073,
    strictPort: true,
    proxy: {
      "/v1": {
        target: "http://127.0.0.1:8071",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
