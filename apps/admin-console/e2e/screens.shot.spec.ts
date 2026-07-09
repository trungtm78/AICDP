import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Chụp ảnh màn hình THẬT (đã đăng nhập qua storageState) để đưa vào tài liệu.
// Chạy: cd apps/admin-console && pnpm exec playwright test screens.shot --config playwright.config.ts
// Yêu cầu: core-api :8071 + admin-console :8073 đang chạy + đã seed demo.
const OUT = "../../docs/assets/screens";
mkdirSync(OUT, { recursive: true });
test.use({ viewport: { width: 1440, height: 1024 } });

async function shot(page: import("@playwright/test").Page, name: string) {
  await page.waitForTimeout(900); // chờ dữ liệu/animation
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

test("screenshots các workspace", async ({ page }) => {
  test.setTimeout(120_000);

  await page.goto("/control-tower");
  await page.waitForTimeout(1500);
  await shot(page, "control-tower");

  await page.goto("/insights");
  await page.waitForTimeout(1800);
  await shot(page, "insights");

  // Customer 360 + phân tích hành vi AI (tra cứu khách demo thật)
  await page.goto("/customers");
  await page.getByLabel("Loại định danh").selectOption("phone");
  await page.getByLabel("Giá trị định danh").fill("0910002096");
  await page.getByRole("button", { name: "Tra cứu" }).click();
  await page.waitForTimeout(2200); // chờ feature/NBA
  await shot(page, "customer360");

  await page.goto("/audiences");
  await shot(page, "audiences");

  await page.goto("/data-ops");
  await page.waitForTimeout(1200);
  await shot(page, "data-ops");

  await page.goto("/ai-governance");
  await page.waitForTimeout(1500);
  await shot(page, "ai-governance");

  await page.goto("/assistant");
  await shot(page, "assistant");

  await page.goto("/loyalty");
  await shot(page, "loyalty");
});
