import { test, expect } from "@playwright/test";

// Luồng đăng nhập thật qua UI: bắt đầu KHÔNG có phiên -> màn login -> vào Control Tower.
test.describe("Auth gate", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("chưa đăng nhập hiện màn login; đăng nhập đúng vào hệ thống", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Đăng nhập" })).toBeVisible();
    await page.getByLabel("Tên đăng nhập").fill("admin");
    await page.getByLabel("Mật khẩu").fill("admin12345");
    await page.getByRole("button", { name: "Đăng nhập" }).click();
    await expect(page.getByRole("heading", { name: "Control Tower" })).toBeVisible();
  });
});

// E2E click qua UI thật. Data tạo MỚI qua chính form trên UI (không seed qua API).
// Dùng hậu tố thời gian để mỗi lần chạy không đụng unique constraint của DB dev.
const stamp = Date.now();

test.describe("Admin Console — Master Data + Customer 360 qua UI", () => {
  test("Control Tower hiển thị KPI tổng hợp thật từ analytics", async ({ page }) => {
    await page.goto("/control-tower");
    await expect(page.getByRole("heading", { name: "Control Tower" })).toBeVisible();
    // KPI tiles có dữ liệu thật (brands seed = 5 -> tile master hiển thị)
    await expect(page.getByTestId("kpi-customers")).toBeVisible();
    await expect(page.getByTestId("kpi-revenue")).toBeVisible();
    await expect(page.getByTestId("kpi-master")).toContainText("5");
  });

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
    await page.getByRole("link", { name: "Loyalty" }).click();
    await expect(page.getByRole("heading", { name: "Loyalty" })).toBeVisible();
    await page.getByRole("link", { name: "Governance" }).click();
    await expect(page.getByRole("heading", { name: "Governance · Consent" })).toBeVisible();
    await page.getByRole("link", { name: "Audiences" }).click();
    await expect(page.getByRole("heading", { name: "Audiences · Activation" })).toBeVisible();
    await page.getByRole("link", { name: "Journeys" }).click();
    await expect(page.getByRole("heading", { name: "Journeys" })).toBeVisible();
    await expect(page.getByLabel("Tên journey")).toBeVisible();
    await page.getByRole("link", { name: "Platform" }).click();
    await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
  });

  test("Platform: hiển thị user admin (dev seed) + form tạo API key", async ({ page }) => {
    await page.goto("/platform");
    await expect(page.getByRole("heading", { name: "Platform" })).toBeVisible();
    // user admin dev seed (name 'Dev Admin') phải xuất hiện trong bảng
    await expect(page.getByRole("cell", { name: "Dev Admin", exact: true })).toBeVisible();
    await expect(page.getByLabel("Tên API key")).toBeVisible();
  });

  test("Audiences: nút kích hoạt disabled khi chưa nhập tên/occId", async ({ page }) => {
    await page.goto("/audiences");
    await expect(page.getByRole("button", { name: "Kích hoạt" })).toBeDisabled();
    await page.getByLabel("Tên audience").fill("Test");
    // vẫn disabled vì chưa có occId
    await expect(page.getByRole("button", { name: "Kích hoạt" })).toBeDisabled();
  });

  test("Governance: deny-by-default — occId chưa có consent hiển thị tất cả purpose = denied", async ({
    page,
  }) => {
    await page.goto("/governance");
    const btn = page.getByRole("button", { name: "Xem consent" });
    await expect(btn).toBeDisabled();

    await page.getByLabel("OCH ID").fill("00000000-0000-0000-0000-0000000000bb");
    await btn.click();
    const row = page.getByTestId("consent-marketing_email");
    await expect(row).toBeVisible();
    await expect(row.getByText("DENIED")).toBeVisible();
    // nút Cấp khả dụng, Thu hồi bị khóa (đang denied)
    await expect(row.getByRole("button", { name: "Cấp" })).toBeEnabled();
    await expect(row.getByRole("button", { name: "Thu hồi" })).toBeDisabled();
  });

  test("Loyalty: nút disabled khi trống; xem số dư occId chưa có điểm -> 0/0 + form thao tác", async ({
    page,
  }) => {
    await page.goto("/loyalty");
    const btn = page.getByRole("button", { name: "Xem số dư" });
    await expect(btn).toBeDisabled();

    // occId hợp lệ (uuid) nhưng chưa phát sinh điểm -> projection = 0/0 (data thật từ API).
    await page.getByLabel("OCH ID").fill("00000000-0000-0000-0000-0000000000aa");
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(page.getByTestId("bal-available")).toHaveText("0");
    await expect(page.getByTestId("bal-reserved")).toHaveText("0");
    // form thao tác xuất hiện
    await expect(page.getByLabel("Số điểm cộng")).toBeVisible();
    await expect(page.getByLabel("Số điểm giữ")).toBeVisible();
  });
});
