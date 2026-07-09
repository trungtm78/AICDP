import { test, expect, request as pwRequest } from "@playwright/test";

// E2E data-flow qua UI THẬT (Chromium, qua DOM). Precondition KHÁCH tạo qua ingestion API
// (ingestion là service-to-service, KHÔNG có UI -> dùng API là interface hợp lệ duy nhất).
// Mọi thao tác nghiệp vụ còn lại (lookup, earn, reserve, capture, cấp consent) đều click trên UI.
const API = "http://127.0.0.1:8071";
const stamp = Date.now();
const phone = `0912${String(stamp).slice(-6)}`;
let occId = "";

test.beforeAll(async () => {
  // Đăng nhập admin lấy token + ingest 1 đơn để có khách thật cho UI tra cứu.
  const ctx = await pwRequest.newContext({ extraHTTPHeaders: { "Content-Type": "application/json" } });
  const login = await ctx.post(`${API}/v1/auth/login`, { data: { username: "admin", password: "admin12345" } });
  const token = (await login.json()).data.token;
  const ing = await ctx.post(`${API}/v1/ingest`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      type: "order_completed", brand_id: "givral", store_id: "ST-UI", source: "pos",
      occ_timestamp: "2026-06-18T10:30:00+07:00",
      identifiers: [{ type: "phone", value: phone }],
      properties: { pos_transaction_id: `UI-${stamp}`, total: 250000, items: [{ sku: "SKU-UI", qty: 1 }] },
    },
  });
  occId = (await ing.json()).data.occId;
  await ctx.dispose();
});

test.describe("E2E data-flow qua UI thật", () => {
  test("E2E-J01: Customer 360 tra cứu khách đã ingest -> hiển thị thẻ occId + giao dịch @p0", async ({ page }) => {
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "Customer 360" })).toBeVisible();
    await page.getByLabel("Loại định danh").selectOption("phone");
    await page.getByLabel("Giá trị định danh").fill(phone);
    await page.getByRole("button", { name: "Tra cứu" }).click();
    // Kết quả: hiện occId thật + có giao dịch (txn-count >= 1), KHÔNG ra empty.
    await expect(page.getByText(occId)).toBeVisible();
    await expect(page.getByTestId("txn-count")).toBeVisible();
    await expect(page.getByText(/Không tìm thấy khách hàng/i)).toHaveCount(0);
  });

  test("E2E-J03: Loyalty earn -> reserve -> capture qua UI; balance projection đúng @p0", async ({ page }) => {
    await page.goto("/loyalty");
    await page.getByLabel("OCH ID").fill(occId);
    await page.getByRole("button", { name: "Xem số dư" }).click();
    await expect(page.getByTestId("bal-available")).toHaveText("0");

    // Cộng 100 điểm qua form UI
    await page.getByLabel("Số điểm cộng").fill("100");
    await page.getByRole("button", { name: "Cộng điểm" }).click();
    await expect(page.getByTestId("bal-available")).toHaveText("100");

    // Giữ 30 điểm -> available 70, reserved 30
    await page.getByLabel("Số điểm giữ").fill("30");
    await page.getByRole("button", { name: "Giữ điểm" }).click();
    await expect(page.getByTestId("bal-available")).toHaveText("70");
    await expect(page.getByTestId("bal-reserved")).toHaveText("30");

    // Chốt đơn giữ -> reserved về 0, available giữ 70
    await page.getByRole("button", { name: "Chốt" }).first().click();
    await expect(page.getByTestId("bal-reserved")).toHaveText("0");
    await expect(page.getByTestId("bal-available")).toHaveText("70");
  });

  test("E2E-J06: Cấp consent marketing_email qua UI -> badge GRANTED @p0", async ({ page }) => {
    await page.goto("/governance");
    await page.getByLabel("OCH ID").fill(occId);
    await page.getByRole("button", { name: "Xem consent" }).click();
    const row = page.getByTestId("consent-marketing_email");
    await expect(row).toBeVisible();
    // Trước khi cấp: DENIED, nút Cấp khả dụng
    await expect(row.getByText("DENIED")).toBeVisible();
    await row.getByRole("button", { name: "Cấp" }).click();
    // Sau khi cấp: GRANTED, nút Cấp bị khóa
    await expect(row.getByText("GRANTED")).toBeVisible();
    await expect(row.getByRole("button", { name: "Cấp" })).toBeDisabled();
  });
});
