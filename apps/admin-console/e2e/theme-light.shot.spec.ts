import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Chụp Light mode (toggle) để đối chiếu với Dark mặc định. Tạm thời — có thể xoá.
const OUT = "../../docs/assets/screens";
mkdirSync(OUT, { recursive: true });
test.use({ viewport: { width: 1440, height: 1024 } });

test("light mode screenshots", async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => localStorage.setItem("aicdp-theme", "light"));
  await page.goto("/control-tower");
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/control-tower-light.png` });
  await page.goto("/insights");
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/insights-light.png` });
});
