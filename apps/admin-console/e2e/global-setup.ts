import { request } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Đăng nhập 1 lần (user dev seed) -> lưu storageState (JWT trong localStorage) cho mọi test.
// Yêu cầu đã chạy: services/core-api scripts/seed-dev-user.ts (user admin/admin12345).
export default async function globalSetup(): Promise<void> {
  const ctx = await request.newContext();
  const res = await ctx.post("http://127.0.0.1:8071/v1/auth/login", {
    data: { username: "admin", password: "admin12345" },
  });
  if (!res.ok()) {
    throw new Error(
      `Login dev thất bại (${res.status()}). Chạy: cd services/core-api && pnpm exec tsx scripts/seed-dev-user.ts`,
    );
  }
  const body = await res.json();
  const d = body.data;
  const state = {
    cookies: [],
    origins: [
      {
        origin: "http://localhost:8073",
        localStorage: [
          { name: "occ_token", value: d.token },
          { name: "occ_role", value: d.role },
          { name: "occ_name", value: d.name },
        ],
      },
    ],
  };
  const here = dirname(fileURLToPath(import.meta.url));
  writeFileSync(join(here, ".auth-state.json"), JSON.stringify(state));
  await ctx.dispose();
}
