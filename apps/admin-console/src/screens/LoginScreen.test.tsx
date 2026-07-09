import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/render.js";
import { LoginScreen } from "./LoginScreen.js";
import { api } from "../lib/api.js";
import { ApiError } from "../lib/types.js";
import { getToken } from "../lib/auth.js";

vi.mock("../lib/api.js", () => ({
  api: { login: vi.fn(), requestPasswordReset: vi.fn(), confirmPasswordReset: vi.fn() },
}));
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

describe("LoginScreen — quên mật khẩu (demo-grade)", () => {
  it("bấm 'Quên mật khẩu?' → gửi yêu cầu → có resetToken thì hiện khung demo", async () => {
    m.requestPasswordReset.mockResolvedValue({ ok: true, resetToken: "tok-demo-123" });
    renderWithProviders(<LoginScreen onLoggedIn={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /quên mật khẩu/i }));
    await userEvent.type(screen.getByLabelText(/tên đăng nhập quên mật khẩu/i), "marketer");
    await userEvent.click(screen.getByRole("button", { name: /gửi hướng dẫn đặt lại/i }));

    await waitFor(() => expect(m.requestPasswordReset).toHaveBeenCalledWith("marketer"));
    expect(await screen.findByTestId("demo-reset-box")).toBeInTheDocument();
  });

  it("không có resetToken (chạy thật) → KHÔNG hiện khung demo, vẫn báo đã tiếp nhận", async () => {
    m.requestPasswordReset.mockResolvedValue({ ok: true });
    renderWithProviders(<LoginScreen onLoggedIn={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /quên mật khẩu/i }));
    await userEvent.type(screen.getByLabelText(/tên đăng nhập quên mật khẩu/i), "aikhongbiet");
    await userEvent.click(screen.getByRole("button", { name: /gửi hướng dẫn đặt lại/i }));
    await screen.findByText(/đã tiếp nhận yêu cầu/i);
    expect(screen.queryByTestId("demo-reset-box")).not.toBeInTheDocument();
  });

  it("luồng đặt lại: nhập mật khẩu mới khớp → gọi confirm → hiện 'thành công'", async () => {
    m.requestPasswordReset.mockResolvedValue({ ok: true, resetToken: "tok-demo-456" });
    m.confirmPasswordReset.mockResolvedValue({ ok: true });
    renderWithProviders(<LoginScreen onLoggedIn={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /quên mật khẩu/i }));
    await userEvent.type(screen.getByLabelText(/tên đăng nhập quên mật khẩu/i), "marketer");
    await userEvent.click(screen.getByRole("button", { name: /gửi hướng dẫn đặt lại/i }));
    await userEvent.click(await screen.findByRole("button", { name: /mở màn đặt lại mật khẩu/i }));

    await userEvent.type(screen.getByLabelText(/^mật khẩu mới$/i), "matkhaumoi456");
    await userEvent.type(screen.getByLabelText(/nhập lại mật khẩu mới/i), "matkhaumoi456");
    await userEvent.click(screen.getByRole("button", { name: /^đặt lại mật khẩu$/i }));

    await waitFor(() =>
      expect(m.confirmPasswordReset).toHaveBeenCalledWith("tok-demo-456", "matkhaumoi456"),
    );
    expect(await screen.findByTestId("reset-done")).toBeInTheDocument();
  });

  it("token hỏng → hiện message lỗi từ API", async () => {
    m.requestPasswordReset.mockResolvedValue({ ok: true, resetToken: "tok-hong" });
    m.confirmPasswordReset.mockRejectedValue(
      new ApiError("Link đặt lại không hợp lệ, đã hết hạn hoặc đã được sử dụng.", "RESET_TOKEN_INVALID", 400, null),
    );
    renderWithProviders(<LoginScreen onLoggedIn={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /quên mật khẩu/i }));
    await userEvent.type(screen.getByLabelText(/tên đăng nhập quên mật khẩu/i), "marketer");
    await userEvent.click(screen.getByRole("button", { name: /gửi hướng dẫn đặt lại/i }));
    await userEvent.click(await screen.findByRole("button", { name: /mở màn đặt lại mật khẩu/i }));
    await userEvent.type(screen.getByLabelText(/^mật khẩu mới$/i), "matkhaumoi456");
    await userEvent.type(screen.getByLabelText(/nhập lại mật khẩu mới/i), "matkhaumoi456");
    await userEvent.click(screen.getByRole("button", { name: /^đặt lại mật khẩu$/i }));
    await screen.findByText(/không hợp lệ, đã hết hạn/i);
  });
});
