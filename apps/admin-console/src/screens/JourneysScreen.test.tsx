import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { JourneysScreen } from "./JourneysScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { listJourneys: vi.fn(), createJourney: vi.fn(), runJourney: vi.fn() },
}));
const m = vi.mocked(api);
const JID = "33333333-3333-3333-3333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  m.listJourneys.mockResolvedValue([]);
});

describe("JourneysScreen", () => {
  it("tạo journey loyalty_bonus gọi API rồi refetch", async () => {
    m.createJourney.mockResolvedValue({
      journey_id: JID,
      name: "VIP bonus",
      segment_criteria: { minSpend: 250000 },
      action: { type: "loyalty_bonus", points: 100 },
      status: "active",
      created_at: "2026-06-18T00:00:00Z",
    });
    renderWithProviders(<JourneysScreen />);

    await userEvent.type(screen.getByLabelText(/tên journey/i), "VIP bonus");
    await userEvent.type(screen.getByLabelText(/chi tiêu tối thiểu/i), "250000");
    await userEvent.type(screen.getByLabelText(/số điểm thưởng/i), "100");
    await userEvent.click(screen.getByRole("button", { name: /tạo journey/i }));

    await waitFor(() =>
      expect(m.createJourney).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "VIP bonus",
          action: { type: "loyalty_bonus", points: 100 },
        }),
      ),
    );
    expect(m.listJourneys).toHaveBeenCalledTimes(2); // mount + sau khi tạo
  });

  it("chạy journey hiển thị kết quả run", async () => {
    m.listJourneys.mockResolvedValue([
      {
        journey_id: JID,
        name: "VIP bonus",
        segment_criteria: { minSpend: 250000 },
        action: { type: "loyalty_bonus", points: 100 },
        status: "active",
        created_at: "2026-06-18T00:00:00Z",
      },
    ]);
    m.runJourney.mockResolvedValue({
      runId: "run-1",
      total: 3,
      actionResult: { kind: "loyalty_bonus", credited: 3, points: 100 },
    });
    renderWithProviders(<JourneysScreen />);
    const row = await screen.findByTestId(`journey-${JID}`);
    await userEvent.click(within(row).getByRole("button", { name: /chạy/i }));

    await waitFor(() => expect(m.runJourney).toHaveBeenCalledWith(JID));
    // khối kết quả run hiển thị (nhãn "Đối tượng:" + số đã cộng điểm)
    await waitFor(() => expect(within(row).getByText(/Đối tượng:/)).toBeInTheDocument());
    expect(within(row).getByText(/Cộng điểm:/)).toBeInTheDocument();
  });
});
