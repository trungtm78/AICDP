import { test, expect } from "@playwright/test";

// E2E click qua UI thật. Data tạo MỚI qua chính form trên UI (không seed qua API).
// Dùng hậu tố thời gian để mỗi lần chạy không đụng unique constraint của DB dev.
const stamp = Date.now();

test.describe("Admin Console — Master Data + Customer 360 qua UI", () => {
  test("Data Ops hiển thị thương hiệu lấy từ API", async ({ page }) => {
    await page.goto("/data-ops");
    await expect(page.getByRole("heading", { name: "Master Data" })).toBeVisible();
    // 5 brand seed phải hiện trong bảng (data từ core-api, không hardcode).
    // exact:true để không đụng cell mã 'givral' (substring match mặc định).
    await expect(page.getByRole("cell", { name: "Givral", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Fuji Foods", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Kem Tràng Tiền", exact: true })).toBeVisible();
  });

  test("Tạo sản phẩm mới qua form UI rồi thấy trong danh sách", async ({ page }) => {
    const pmId = `e2e-pm-${stamp}`;
    const pmName = `Bánh kem E2E ${stamp}`;
    await page.goto("/data-ops");
    await page.getByLabel("Mã sản phẩm").fill(pmId);
    await page.getByLabel("Tên sản phẩm").fill(pmName);
    await page.getByRole("button", { name: "Thêm sản phẩm" }).click();
    // Xuất hiện trong danh sách sản phẩm (refetch sau khi tạo)
    await expect(page.getByText(pmId)).toBeVisible();
    await expect(page.getByText(pmName)).toBeVisible();
  });

  test("Tạo cửa hàng mới qua form UI (chọn brand) rồi thấy trong danh sách", async ({ page }) => {
    const storeId = `e2e-store-${stamp}`;
    const storeName = `Givral E2E ${stamp}`;
    await page.goto("/data-ops");
    await page.getByLabel("Mã cửa hàng").fill(storeId);
    await page.getByLabel("Thương hiệu của cửa hàng").selectOption("givral");
    await page.getByLabel("Tên cửa hàng").fill(storeName);
    await page.getByLabel("Thành phố").fill("HCM");
    await page.getByRole("button", { name: "Thêm cửa hàng" }).click();
    await expect(page.getByText(storeId)).toBeVisible();
    await expect(page.getByText(storeName)).toBeVisible();
  });

  test("Customer 360: nút tra cứu disabled khi trống; tra cứu KH không tồn tại -> empty", async ({
    page,
  }) => {
    await page.goto("/customers");
    await expect(page.getByRole("heading", { name: "Customer 360" })).toBeVisible();
    const btn = page.getByRole("button", { name: "Tra cứu" });
    await expect(btn).toBeDisabled();

    await page.getByLabel("Giá trị định danh").fill("0900000000");
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(page.getByText(/Không tìm thấy khách hàng/i)).toBeVisible();
  });

  test("Điều hướng sidebar giữa các workspace hoạt động", async ({ page }) => {
    await page.goto("/");
    // mặc định redirect -> Control Tower
    await expect(page.getByRole("heading", { name: "Control Tower" })).toBeVisible();
    await page.getByRole("link", { name: "Customers" }).click();
    await expect(page.getByRole("heading", { name: "Customer 360" })).toBeVisible();
    await page.getByRole("link", { name: "Data Ops" }).click();
    await expect(page.getByRole("heading", { name: "Master Data" })).toBeVisible();
  });
});
