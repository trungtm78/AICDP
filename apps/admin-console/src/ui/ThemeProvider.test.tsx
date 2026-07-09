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
  it("mặc định light khi chưa có localStorage (OCH heritage)", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button")).toHaveTextContent("theme:light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("aicdp-theme")).toBe("light");
  });

  it("toggle lật light ↔ dark + ghi localStorage + data-theme", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("button")).toHaveTextContent("theme:dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("aicdp-theme")).toBe("dark");
    // lật lại về light
    await userEvent.click(screen.getByRole("button"));
    expect(document.documentElement.dataset.theme).toBe("light");
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
