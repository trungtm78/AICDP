import { test } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Chụp UI Journey Builder (list + canvas + report + participants) cho cả 2 theme.
const OUT = "../../docs/assets/screens";
mkdirSync(OUT, { recursive: true });
const JID = process.env.JID ?? "";
test.use({ viewport: { width: 1440, height: 1024 } });

async function shots(page: import("@playwright/test").Page, suffix: string) {
  await page.goto("/journeys");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/journeys-list${suffix}.png` });
  if (JID) {
    await page.goto(`/journeys/${JID}`);
    await page.waitForTimeout(1800); // react-flow render
    await page.screenshot({ path: `${OUT}/journey-canvas${suffix}.png` });
    await page.goto(`/journeys/${JID}?tab=report`);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: `${OUT}/journey-report${suffix}.png` });
    await page.goto(`/journeys/${JID}?tab=participants`);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/journey-participants${suffix}.png` });
  }
}

test("journey UI dark", async ({ page }) => {
  test.setTimeout(90_000);
  await shots(page, ""); // mặc định dark
});

test("journey UI light", async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => localStorage.setItem("aicdp-theme", "light"));
  await shots(page, "-light");
});
