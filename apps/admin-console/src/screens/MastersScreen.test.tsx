import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { MastersScreen } from "./MastersScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: {
    listBrands: vi.fn(),
    listStores: vi.fn(),
    listProducts: vi.fn(),
    createStore: vi.fn(),
    createProduct: vi.fn(),
  },
}));

const m = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  m.listBrands.mockResolvedValue([
    { brand_id: "givral", name: "Givral", industry: "F&B", brand_accent: null, status: "active" },
    { brand_id: "fuji", name: "Fuji", industry: "F&B", brand_accent: null, status: "active" },
  ]);
  m.listStores.mockResolvedValue([]);
  m.listProducts.mockResolvedValue([]);
});

describe("MastersScreen", () => {
  it("hiển thị danh sách brand lấy từ API (không hardcode)", async () => {
    renderWithProviders(<MastersScreen />);
    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "Givral" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("cell", { name: "Fuji" })).toBeInTheDocument();
    expect(m.listBrands).toHaveBeenCalled();
  });

  it("tạo product mới gọi API rồi refetch danh sách", async () => {
    m.createProduct.mockResolvedValue({ product_master_id: "pm-1" });
    renderWithProviders(<MastersScreen />);
    await waitFor(() =>
      expect(screen.getByRole("cell", { name: "Givral" })).toBeInTheDocument(),
    );

    await userEvent.type(screen.getByLabelText(/mã sản phẩm/i), "pm-1");
    await userEvent.type(screen.getByLabelText(/tên sản phẩm/i), "Bánh kem dâu");
    await userEvent.click(screen.getByRole("button", { name: /thêm sản phẩm/i }));

    await waitFor(() =>
      expect(m.createProduct).toHaveBeenCalledWith(
        expect.objectContaining({ product_master_id: "pm-1", name: "Bánh kem dâu" }),
      ),
    );
    // refetch sau khi tạo
    expect(m.listProducts).toHaveBeenCalledTimes(2);
  });

  it("khi API list sản phẩm lỗi -> hiển thị trạng thái lỗi (không im lặng thành rỗng)", async () => {
    m.listProducts.mockRejectedValue(new Error("boom"));
    renderWithProviders(<MastersScreen />);
    await waitFor(() =>
      expect(screen.getByText(/lỗi tải sản phẩm/i)).toBeInTheDocument(),
    );
  });
});
