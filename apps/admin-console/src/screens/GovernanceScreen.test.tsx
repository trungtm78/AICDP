import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { GovernanceScreen } from "./GovernanceScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { listConsents: vi.fn(), recordConsent: vi.fn() },
}));
const m = vi.mocked(api);
const OCC = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GovernanceScreen — consent deny-by-default", () => {
  it("purpose chưa có bản ghi hiển thị 'denied' (deny-by-default)", async () => {
    m.listConsents.mockResolvedValue([]);
    renderWithProviders(<GovernanceScreen />);
    await userEvent.type(screen.getByLabelText(/och id/i), OCC);
    await userEvent.click(screen.getByRole("button", { name: /xem consent/i }));

    const row = await screen.findByTestId("consent-marketing_email");
    expect(within(row).getByText(/denied/i)).toBeInTheDocument();
  });

  it("cấp consent gọi API granted rồi refetch", async () => {
    m.listConsents.mockResolvedValueOnce([]);
    m.recordConsent.mockResolvedValue({
      purpose: "marketing_email",
      status: "granted",
      recorded_at: "2026-06-18T00:00:00Z",
    });
    m.listConsents.mockResolvedValueOnce([
      { purpose: "marketing_email", status: "granted", recorded_at: "2026-06-18T00:00:00Z" },
    ]);

    renderWithProviders(<GovernanceScreen />);
    await userEvent.type(screen.getByLabelText(/och id/i), OCC);
    await userEvent.click(screen.getByRole("button", { name: /xem consent/i }));

    const row = await screen.findByTestId("consent-marketing_email");
    await userEvent.click(within(row).getByRole("button", { name: /cấp/i }));

    await waitFor(() =>
      expect(m.recordConsent).toHaveBeenCalledWith(OCC, "marketing_email", "granted", "csr"),
    );
    await waitFor(() => expect(within(row).getByText(/granted/i)).toBeInTheDocument());
  });

  it("đổi input OCC sau khi load -> thao tác vẫn ghi cho OCC ĐÃ LOAD (không phải input mới)", async () => {
    m.listConsents.mockResolvedValue([]);
    m.recordConsent.mockResolvedValue({
      purpose: "marketing_email",
      status: "granted",
      recorded_at: "2026-06-18T00:00:00Z",
    });
    renderWithProviders(<GovernanceScreen />);
    await userEvent.type(screen.getByLabelText(/och id/i), OCC);
    await userEvent.click(screen.getByRole("button", { name: /xem consent/i }));
    await screen.findByTestId("consent-marketing_email");

    // người dùng sửa input sang OCC khác nhưng CHƯA bấm "Xem consent"
    const OTHER = "99999999-9999-9999-9999-999999999999";
    await userEvent.clear(screen.getByLabelText(/och id/i));
    await userEvent.type(screen.getByLabelText(/och id/i), OTHER);

    const row = screen.getByTestId("consent-marketing_email");
    await userEvent.click(within(row).getByRole("button", { name: /cấp/i }));
    await waitFor(() =>
      expect(m.recordConsent).toHaveBeenCalledWith(OCC, "marketing_email", "granted", "csr"),
    );
  });
});
