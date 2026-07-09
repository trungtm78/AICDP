// Theme biểu đồ — đọc token CSS lúc render nên TỰ đổi theo light/dark (data-theme).
// Palette dữ liệu CVD-safe, thứ tự cố định; neutrals/accent lấy từ biến --color-*.

const FONT = "'Geist Variable', system-ui, sans-serif";

/** Đọc biến CSS trên :root; fallback khi SSR/jsdom (getComputedStyle rỗng). */
export function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function isDark(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";
}

export interface ChartTokens {
  text: string;
  subtle: string;
  axis: string;
  surface: string;
  accent: string;
  violet: string;
  cyan: string;
}

/** Neutrals + accent theo theme hiện tại (đọc token). */
export function chartTokens(): ChartTokens {
  return {
    text: cssVar("--color-text-muted", "#565e73"),
    subtle: cssVar("--color-text-subtle", "#98a0b3"),
    axis: cssVar("--color-border", "#e6e8f0"),
    surface: cssVar("--color-surface", "#ffffff"),
    accent: cssVar("--color-accent", "#4f46e5"),
    violet: cssVar("--color-violet", "#7c3aed"),
    cyan: cssVar("--color-cyan", "#06b6d4"),
  };
}

/** Palette dữ liệu (categorical) OCH — dẫn navy + gold; bản sáng hơn trên dark. */
export function vizPalette(): string[] {
  return isDark()
    ? ["#d4a960", "#2dd4bf", "#7cc0ff", "#4ade80", "#a78bfa", "#f0e0c0"]
    : ["#2e2e40", "#c39851", "#1baf7a", "#2a78d6", "#7c3aed", "#2f7d5b"];
}

/** Tooltip theo token (nền surface, viền border, chữ text). */
export function tooltip() {
  return {
    backgroundColor: cssVar("--color-surface", "#ffffff"),
    borderColor: cssVar("--color-border", "#e6e8f0"),
    borderWidth: 1,
    padding: [8, 12] as [number, number],
    textStyle: { color: cssVar("--color-text", "#0f172a"), fontSize: 12, fontFamily: FONT },
    extraCssText: "box-shadow: 0 8px 24px -8px rgb(0 0 0 / 0.35); border-radius: 8px;",
  };
}

/** Style trục (hairline theo border token, chữ theo text-subtle). */
export function axisStyle(_opts: { numeric?: boolean } = {}) {
  const t = chartTokens();
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: t.axis, type: "dashed" as const } },
    axisLabel: { color: t.subtle, fontSize: 11, fontFamily: FONT },
  };
}

/** Vùng area translucent cho line (theo theme). */
export function areaColor(kind: "accent" | "violet"): string {
  if (kind === "violet") return isDark() ? "rgba(212,169,96,0.16)" : "rgba(195,152,81,0.12)"; // gold band
  return isDark() ? "rgba(212,169,96,0.16)" : "rgba(46,46,64,0.10)"; // navy/gold
}

/** Dải màu heatmap theo theme (cream→gold→navy OCH). */
export function heatmapRange(): string[] {
  return isDark() ? ["#2a2413", "#d4a960", "#f0e0c0"] : ["#f2f0e9", "#c39851", "#2e2e40"];
}

// Hằng tiện dụng (light) cho nơi cần màu tĩnh.
export const ACCENT = "#2e2e40";
export const CYAN = "#2a78d6";
export const VIOLET = "#7c3aed";
export { FONT };
