import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "./ThemeProvider.js";

function Probe() {
  const { theme, toggle } = useTheme();
  return (
    <button type="button" onClick={toggle}>
      theme:{theme}
    </button>
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("ThemeProvider", () => {
  it("mặc định dark khi chưa có localStorage", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("theme:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("aicdp-theme")).toBe("dark");
  });

  it("toggle lật dark ↔ light + ghi localStorage + data-theme", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("theme:light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("aicdp-theme")).toBe("light");
    // lật lại về dark
    await userEvent.click(screen.getByRole("button"));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("khôi phục theme đã lưu từ localStorage", () => {
    localStorage.setItem("aicdp-theme", "light");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("theme:light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
