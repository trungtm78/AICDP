import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { LoyaltyScreen } from "./LoyaltyScreen.js";
import { api } from "../lib/api.js";
import { ApiError } from "../lib/types.js";

vi.mock("../lib/api.js", () => ({
  api: {
    getLoyaltyBalance: vi.fn(),
    loyaltyEarn: vi.fn(),
    loyaltyReserve: vi.fn(),
    loyaltyCapture: vi.fn(),
    loyaltyRelease: vi.fn(),
  },
}));
const m = vi.mocked(api);
const OCC = "11111111-1111-1111-1111-111111111111";
const RES = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

async function showBalance(available: number, reserved: number) {
  m.getLoyaltyBalance.mockResolvedValue({ available, reserved });
  renderWithProviders(<LoyaltyScreen />);
  await userEvent.type(screen.getByLabelText(/occ id/i), OCC);
  await userEvent.click(screen.getByRole("button", { name: /xem số dư/i }));
  await waitFor(() => expect(screen.getByTestId("bal-available")).toBeInTheDocument());
}

describe("LoyaltyScreen", () => {
  it("xem số dư hiển thị available/reserved từ API", async () => {
    await showBalance(120, 30);
    expect(screen.getByTestId("bal-available")).toHaveTextContent("120");
    expect(screen.getByTestId("bal-reserved")).toHaveTextContent("30");
    expect(m.getLoyaltyBalance).toHaveBeenCalledWith(OCC);
  });

  it("cộng điểm gọi earn rồi refetch số dư", async () => {
    await showBalance(0, 0);
    m.loyaltyEarn.mockResolvedValue({
      txnId: "t1",
      balance: { available: 50, reserved: 0 },
      idempotent: false,
    });
    m.getLoyaltyBalance.mockResolvedValue({ available: 50, reserved: 0 });

    await userEvent.type(screen.getByLabelText(/số điểm cộng/i), "50");
    await userEvent.click(screen.getByRole("button", { name: /cộng điểm/i }));

    await waitFor(() =>
      expect(m.loyaltyEarn).toHaveBeenCalledWith(OCC, 50, expect.any(String)),
    );
    await waitFor(() => expect(screen.getByTestId("bal-available")).toHaveTextContent("50"));
  });

  it("giữ điểm tạo reservation; chốt reservation gọi capture", async () => {
    await showBalance(100, 0);
    m.loyaltyReserve.mockResolvedValue({
      txnId: "t2",
      reservationId: RES,
      balance: { available: 60, reserved: 40 },
      idempotent: false,
    });
    m.getLoyaltyBalance.mockResolvedValue({ available: 60, reserved: 40 });

    await userEvent.type(screen.getByLabelText(/số điểm giữ/i), "40");
    await userEvent.click(screen.getByRole("button", { name: /giữ điểm/i }));

    await waitFor(() =>
      expect(m.loyaltyReserve).toHaveBeenCalledWith(OCC, 40, expect.any(String)),
    );
    // reservation xuất hiện trong danh sách
    const row = await screen.findByTestId(`reservation-${RES}`);
    expect(within(row).getByText(/40/)).toBeInTheDocument();

    m.loyaltyCapture.mockResolvedValue({
      txnId: "t3",
      balance: { available: 60, reserved: 0 },
      idempotent: false,
    });
    await userEvent.click(within(row).getByRole("button", { name: /chốt/i }));
    await waitFor(() =>
      expect(m.loyaltyCapture).toHaveBeenCalledWith(RES, expect.any(String)),
    );
  });

  it("lỗi nghiệp vụ (INSUFFICIENT_BALANCE) khi giữ điểm -> hiển thị thông báo", async () => {
    await showBalance(10, 0);
    m.loyaltyReserve.mockRejectedValue(
      new ApiError("Không đủ điểm khả dụng để giữ", "INSUFFICIENT_BALANCE", 409, null),
    );
    await userEvent.type(screen.getByLabelText(/số điểm giữ/i), "100");
    await userEvent.click(screen.getByRole("button", { name: /giữ điểm/i }));
    await waitFor(() =>
      expect(screen.getByText(/không đủ điểm khả dụng/i)).toBeInTheDocument(),
    );
  });
});
