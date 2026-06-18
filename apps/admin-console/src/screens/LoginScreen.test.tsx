import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { LoginScreen } from "./LoginScreen.js";
import { api } from "../lib/api.js";
import { ApiError } from "../lib/types.js";
import { getToken } from "../lib/auth.js";

vi.mock("../lib/api.js", () => ({ api: { login: vi.fn() } }));
const m = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("LoginScreen", () => {
  it("đăng nhập thành công lưu token và gọi onLoggedIn", async () => {
    m.login.mockResolvedValue({ token: "jwt-abc", role: "admin", name: "Admin" });
    const onLoggedIn = vi.fn();
    renderWithProviders(<LoginScreen onLoggedIn={onLoggedIn} />);

    await userEvent.type(screen.getByLabelText(/tên đăng nhập/i), "admin");
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), "admin12345");
    await userEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));

    await waitFor(() => expect(onLoggedIn).toHaveBeenCalled());
    expect(m.login).toHaveBeenCalledWith("admin", "admin12345");
    expect(getToken()).toBe("jwt-abc");
  });

  it("sai mật khẩu (401) hiển thị lỗi, không lưu token", async () => {
    m.login.mockRejectedValue(new ApiError("Sai", "UNAUTHENTICATED", 401, null));
    renderWithProviders(<LoginScreen onLoggedIn={vi.fn()} />);
    await userEvent.type(screen.getByLabelText(/tên đăng nhập/i), "admin");
    await userEvent.type(screen.getByLabelText(/mật khẩu/i), "x");
    await userEvent.click(screen.getByRole("button", { name: /đăng nhập/i }));
    await waitFor(() =>
      expect(screen.getByText(/sai tên đăng nhập hoặc mật khẩu/i)).toBeInTheDocument(),
    );
    expect(getToken()).toBeNull();
  });
});
