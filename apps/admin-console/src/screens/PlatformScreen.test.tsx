import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { PlatformScreen } from "./PlatformScreen.js";
import { api } from "../lib/api.js";

vi.mock("../lib/api.js", () => ({
  api: {
    listUsers: vi.fn(),
    createUser: vi.fn(),
    setUserStatus: vi.fn(),
    listApiKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeApiKey: vi.fn(),
  },
}));
const m = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  m.listUsers.mockResolvedValue([
    { id: "u1", username: "admin", role: "data_steward", name: "Admin", status: "active", created_at: "" },
  ]);
  m.listApiKeys.mockResolvedValue([]);
});

describe("PlatformScreen", () => {
  it("hiển thị danh sách user từ API", async () => {
    renderWithProviders(<PlatformScreen />);
    const row = await screen.findByTestId("user-u1");
    expect(within(row).getByText("admin")).toBeInTheDocument(); // username trong hàng
    expect(m.listUsers).toHaveBeenCalled();
  });

  it("tạo API key hiển thị raw key MỘT lần", async () => {
    m.createApiKey.mockResolvedValue({
      id: "9",
      name: "pos-connector",
      role: "connector",
      rawKey: "occ_SECRET_RAW_123",
    });
    renderWithProviders(<PlatformScreen />);
    await userEvent.type(screen.getByLabelText(/tên api key/i), "pos-connector");
    await userEvent.selectOptions(screen.getByLabelText(/vai trò api key/i), "connector");
    await userEvent.click(screen.getByRole("button", { name: /tạo api key/i }));

    await waitFor(() =>
      expect(m.createApiKey).toHaveBeenCalledWith("pos-connector", "connector"),
    );
    // raw key hiển thị để copy (chỉ lần này)
    await waitFor(() => expect(screen.getByTestId("new-raw-key")).toHaveTextContent("occ_SECRET_RAW_123"));
    expect(m.listApiKeys).toHaveBeenCalledTimes(2); // mount + sau khi tạo
  });

  it("disable user gọi setUserStatus", async () => {
    renderWithProviders(<PlatformScreen />);
    const row = await screen.findByTestId("user-u1");
    await userEvent.click(within(row).getByRole("button", { name: /vô hiệu/i }));
    await waitFor(() => expect(m.setUserStatus).toHaveBeenCalledWith("u1", "disabled"));
  });
});
