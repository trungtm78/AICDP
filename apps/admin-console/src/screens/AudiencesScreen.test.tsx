import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { AudiencesScreen } from "./AudiencesScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: { activate: vi.fn(), previewSegment: vi.fn(), listBrands: vi.fn() },
}));
const m = vi.mocked(api);

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  m.listBrands.mockResolvedValue([
    { brand_id: "givral", name: "Givral", industry: null, brand_accent: null, status: "active" },
  ]);
});

describe("AudiencesScreen — activation consent-gated", () => {
  it("kích hoạt gọi API với occIds parse từ textarea và hiển thị summary", async () => {
    m.activate.mockResolvedValue({
      runId: "run-1",
      total: 2,
      allowedCount: 1,
      suppressedCount: 1,
      allowed: [A],
    });

    renderWithProviders(<AudiencesScreen />);
    await userEvent.type(screen.getByLabelText(/tên audience/i), "KH thân thiết");
    await userEvent.type(screen.getByLabelText(/danh sách aicdp id/i), `${A}\n${B}`);
    await userEvent.click(screen.getByRole("button", { name: /kích hoạt/i }));

    await waitFor(() =>
      expect(m.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          audienceName: "KH thân thiết",
          purpose: "marketing_email",
          occIds: [A, B],
        }),
      ),
    );
    expect(await screen.findByTestId("act-allowed")).toHaveTextContent("1");
    expect(screen.getByTestId("act-suppressed")).toHaveTextContent("1");
    expect(screen.getByTestId("act-total")).toHaveTextContent("2");
  });

  it("nút kích hoạt disabled khi chưa nhập tên hoặc occId", () => {
    renderWithProviders(<AudiencesScreen />);
    expect(screen.getByRole("button", { name: /kích hoạt/i })).toBeDisabled();
  });

  it("xem trước segment điền danh sách aicdp id vào textarea", async () => {
    m.previewSegment.mockResolvedValue({ count: 2, occIds: [A, B] });
    renderWithProviders(<AudiencesScreen />);

    await userEvent.type(screen.getByLabelText(/chi tiêu tối thiểu/i), "250000");
    await userEvent.click(screen.getByRole("button", { name: /xem trước segment/i }));

    await waitFor(() =>
      expect(m.previewSegment).toHaveBeenCalledWith(
        expect.objectContaining({ minSpend: 250000 }),
      ),
    );
    // textarea OCC ID được điền từ segment
    await waitFor(() =>
      expect(screen.getByLabelText(/danh sách aicdp id/i)).toHaveValue(`${A}\n${B}`),
    );
    expect(screen.getByTestId("segment-count")).toHaveTextContent("2");
  });
});
