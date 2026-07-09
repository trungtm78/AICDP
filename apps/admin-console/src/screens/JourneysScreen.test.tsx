import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { JourneysScreen } from "./JourneysScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { jListJourneys: vi.fn(), jCreateJourney: vi.fn() },
}));
const m = vi.mocked(api);
const JID = "33333333-3333-3333-3333-333333333333";

function summary(over: Partial<Record<string, unknown>> = {}) {
  return {
    journey_id: JID, name: "VIP bonus", status: "active", trigger_type: "manual", trigger_config: {},
    definition: null, published_version: 1, allow_re_enroll: false, created_at: "", updated_at: "", published_at: null,
    participants: 12, completed: 5, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.jListJourneys.mockResolvedValue([]);
});

describe("JourneysScreen (list)", () => {
  it("hiển thị journey từ API trong bảng", async () => {
    m.jListJourneys.mockResolvedValue([summary() as never]);
    renderWithProviders(<JourneysScreen />);
    expect(await screen.findByText("VIP bonus")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument(); // participants
    expect(m.jListJourneys).toHaveBeenCalled();
  });

  it("tạo journey draft gọi jCreateJourney với trigger đã chọn", async () => {
    m.jCreateJourney.mockResolvedValue(summary({ status: "draft" }) as never);
    renderWithProviders(<JourneysScreen />);

    // mở modal (nút header)
    await userEvent.click(screen.getAllByRole("button", { name: /tạo journey/i })[0]!);
    await userEvent.type(screen.getByLabelText(/tên journey/i), "Chào mừng");
    await userEvent.click(screen.getByRole("button", { name: /tạo & mở canvas/i }));

    await waitFor(() =>
      expect(m.jCreateJourney).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Chào mừng", triggerType: "manual" }),
      ),
    );
  });
});
