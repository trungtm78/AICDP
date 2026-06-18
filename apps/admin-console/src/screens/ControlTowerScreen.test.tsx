import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/render.js";
import { ControlTowerScreen } from "./ControlTowerScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({ api: { getOverview: vi.fn() } }));
const m = vi.mocked(api);

beforeEach(() => vi.clearAllMocks());

describe("ControlTowerScreen", () => {
  it("hiển thị KPI từ analytics overview", async () => {
    m.getOverview.mockResolvedValue({
      customers: 1234,
      transactions: 5678,
      revenue: 250000,
      loyaltyAvailable: 300,
      loyaltyReserved: 200,
      activationAllowed: 10,
      activationSuppressed: 3,
      brands: 5,
      stores: 12,
      products: 40,
    });

    renderWithProviders(<ControlTowerScreen />);
    await waitFor(() => expect(screen.getByTestId("kpi-customers")).toHaveTextContent("1.234"));
    expect(screen.getByTestId("kpi-transactions")).toHaveTextContent("5.678");
    // doanh thu định dạng VND
    expect(screen.getByTestId("kpi-revenue")).toHaveTextContent("250.000");
    expect(m.getOverview).toHaveBeenCalled();
  });
});
