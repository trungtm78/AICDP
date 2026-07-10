import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "../../docs/assets/screens";
mkdirSync(OUT, { recursive: true });
// iPhone 12/13 viewport
test.use({ viewport: { width: 390, height: 844 } });

test("mobile responsive — shell + màn hình", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/control-tower");
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/mobile-control-tower.png` });

  // mở drawer điều hướng (hamburger)
  await page.getByRole("button", { name: "Mở menu" }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/mobile-nav-drawer.png` });
  // điều hướng sang Dự đoán qua drawer
  await page.getByRole("link", { name: "Dự đoán" }).click();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/mobile-predictions.png` });
});
