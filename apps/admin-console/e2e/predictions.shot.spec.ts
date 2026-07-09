import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "../../docs/assets/screens";
mkdirSync(OUT, { recursive: true });
test.use({ viewport: { width: 1440, height: 1024 } });

test("Predictive Studio render + drill-down dự đoán", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/predictions");
  await expect(page.getByText(/Predictive Studio/)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/predictions.png` });
  // drill-down 1 khách
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/Dự đoán —/)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/predictions-drawer.png` });
});
