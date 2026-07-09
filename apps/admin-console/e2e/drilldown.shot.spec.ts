import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Verify các drill-down mới bằng cách click thật qua UI (đã login qua storageState).
// Chạy: cd apps/admin-console && pnpm exec playwright test drilldown.shot --config playwright.config.ts
const OUT = "../../docs/assets/screens";
mkdirSync(OUT, { recursive: true });
test.use({ viewport: { width: 1440, height: 1024 } });

test("drill-down Loyalty — Lịch sử điểm", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/loyalty");
  await page.waitForTimeout(1200);
  // bấm dòng thành viên đầu tiên trong bảng leaderboard
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/Lịch sử điểm/)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/drill-loyalty.png` });
});

test("drill-down Audiences — khách của lần kích hoạt", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/audiences");
  await page.waitForTimeout(1200);
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/Kết quả —/)).toBeVisible({ timeout: 8000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/drill-audiences.png` });
});

test("drill-down Control Tower — Donut vòng đời điều hướng lọc", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/control-tower");
  await page.waitForTimeout(2000);
  // click vào một lát donut vòng đời (path có fill màu = sector, bỏ path viền/none)
  const slices = page.locator('[data-testid="ct-lifecycle"] svg path[fill]:not([fill="none"]):not([fill="transparent"])');
  const n = await slices.count();
  for (let i = 0; i < n; i++) {
    await slices.nth(i).click({ force: true });
    if (/\/customers\?lifecycle=/.test(page.url())) break;
    await page.waitForTimeout(200);
  }
  await page.waitForURL(/\/customers\?lifecycle=/, { timeout: 8000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/drill-chart-nav.png` });
});
