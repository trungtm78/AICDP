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

/** Palette dữ liệu (categorical) — bản sáng hơn trên dark để đọc rõ. */
export function vizPalette(): string[] {
  return isDark()
    ? ["#818cf8", "#2dd4bf", "#fbbf24", "#4ade80", "#a78bfa", "#22d3ee"]
    : ["#4f46e5", "#1baf7a", "#eda100", "#008300", "#7c3aed", "#06b6d4"];
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
  if (kind === "violet") return isDark() ? "rgba(167,139,250,0.14)" : "rgba(124,58,237,0.08)";
  return isDark() ? "rgba(129,140,248,0.16)" : "rgba(79,70,229,0.10)";
}

/** Dải màu heatmap theo theme. */
export function heatmapRange(): string[] {
  return isDark() ? ["#1b2140", "#818cf8", "#c4b5fd"] : ["#eef2ff", "#4f46e5", "#3730a3"];
}

// Hằng tiện dụng (light) cho nơi cần màu tĩnh.
export const ACCENT = "#4f46e5";
export const CYAN = "#06b6d4";
export const VIOLET = "#7c3aed";
export { FONT };
