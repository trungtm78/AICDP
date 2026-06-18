import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { CustomersScreen } from "./CustomersScreen.js";
import { api } from "../lib/api.js";
import { ApiError } from "../lib/types.js";

vi.mock("../lib/api.js", () => ({
  api: { lookupCustomer: vi.fn(), getRecommendations: vi.fn() },
}));

const mockLookup = vi.mocked(api.lookupCustomer);
const mockRecs = vi.mocked(api.getRecommendations);

beforeEach(() => {
  mockLookup.mockReset();
  mockRecs.mockReset();
  mockRecs.mockResolvedValue({ occId: "occ-123", recommendations: [] });
});

describe("CustomersScreen (Customer 360 lookup)", () => {
  it("tra cứu phone -> hiển thị occId và số giao dịch từ API", async () => {
    mockLookup.mockResolvedValue({
      occId: "occ-123",
      profile: { full_name: "Nguyễn Văn A" },
      identifiers: [{ identifier_type: "phone", value_normalized: "+84901112223" }],
      transactions: [{ message_id: "m1", total: 99000 }],
    });

    renderWithProviders(<CustomersScreen />);
    await userEvent.type(screen.getByLabelText(/giá trị/i), "0901112223");
    await userEvent.click(screen.getByRole("button", { name: /tra cứu/i }));

    await waitFor(() => expect(screen.getByText("occ-123")).toBeInTheDocument());
    expect(mockLookup).toHaveBeenCalledWith("phone", "0901112223");
    expect(screen.getByText(/Nguyễn Văn A/)).toBeInTheDocument();
    // số giao dịch hiển thị (1 giao dịch trong mock)
    expect(screen.getByTestId("txn-count")).toHaveTextContent("1");
    // gợi ý cross-sell được nạp cho occId tìm thấy
    expect(mockRecs).toHaveBeenCalledWith("occ-123");
  });

  it("hiển thị gợi ý cross-sell khi có", async () => {
    mockLookup.mockResolvedValue({
      occId: "occ-9",
      profile: {},
      identifiers: [{ identifier_type: "phone", value_normalized: "+84901112223" }],
      transactions: [],
    });
    mockRecs.mockResolvedValue({
      occId: "occ-9",
      recommendations: [{ sku: "P3", name: "Bánh trung thu", score: 5 }],
    });
    renderWithProviders(<CustomersScreen />);
    await userEvent.type(screen.getByLabelText(/giá trị/i), "0901112223");
    await userEvent.click(screen.getByRole("button", { name: /tra cứu/i }));
    await waitFor(() => expect(screen.getByText(/Bánh trung thu/)).toBeInTheDocument());
  });

  it("không tìm thấy -> hiển thị trạng thái empty, không crash", async () => {
    mockLookup.mockRejectedValue(
      new ApiError("Không tìm thấy", "CUSTOMER_NOT_FOUND", 404, "value"),
    );

    renderWithProviders(<CustomersScreen />);
    await userEvent.type(screen.getByLabelText(/giá trị/i), "0900000000");
    await userEvent.click(screen.getByRole("button", { name: /tra cứu/i }));

    await waitFor(() =>
      expect(screen.getByText(/không tìm thấy khách hàng/i)).toBeInTheDocument(),
    );
  });

  it("nút tra cứu bị vô hiệu khi chưa nhập giá trị", () => {
    renderWithProviders(<CustomersScreen />);
    expect(screen.getByRole("button", { name: /tra cứu/i })).toBeDisabled();
  });
});
