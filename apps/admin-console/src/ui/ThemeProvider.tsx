import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "aicdp-theme";
const DEFAULT_THEME: Theme = "light"; // OCH light-first (heritage navy/gold)

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

/** Đọc theme khởi tạo từ localStorage (mặc định dark). */
function readInitial(): Theme {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s === "light" || s === "dark") return s;
  } catch {
    /* localStorage không khả dụng — dùng mặc định */
  }
  return DEFAULT_THEME;
}

function applyTheme(theme: Theme) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* bỏ qua nếu không ghi được */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggle = useCallback(() => setThemeState((t) => (t === "dark" ? "light" : "dark")), []);

  return <Ctx.Provider value={{ theme, toggle, setTheme }}>{children}</Ctx.Provider>;
}

/** Hook theme; ngoài Provider trả mặc định dark (an toàn cho chart/preview). */
export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return { theme: DEFAULT_THEME, toggle: () => undefined, setTheme: () => undefined };
  return ctx;
}
