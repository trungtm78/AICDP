// DEV-ONLY: tạo user admin để đăng nhập admin-console ở dev.
// Chạy: cd services/core-api && pnpm exec tsx scripts/seed-dev-user.ts
// Mặc định: admin / admin12345 (đổi qua biến môi trường DEV_ADMIN_USER/DEV_ADMIN_PASS).
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { hashPassword } from "../src/auth/password.js";

async function main(): Promise<void> {
  await runMigrations(pool);
  const username = process.env.DEV_ADMIN_USER ?? "admin";
  const password = process.env.DEV_ADMIN_PASS ?? "admin12345";
  await pool.query(
    `INSERT INTO cdp.app_user (username, password_hash, role, name)
     VALUES ($1,$2,'admin','Dev Admin')
     ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash, status='active'`,
    [username, hashPassword(password)],
  );
  // eslint-disable-next-line no-console
  console.log(`Đã seed user dev: ${username} (role admin). ĐỔI mật khẩu/ xoá trước production.`);
  await pool.end();
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
