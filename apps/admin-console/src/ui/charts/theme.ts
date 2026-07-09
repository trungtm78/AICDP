// Theme biểu đồ dùng chung — đồng bộ token DESIGN.md (Indigo AI). Palette CVD-safe, thứ tự cố định.
export const VIZ_PALETTE = ["#4f46e5", "#1baf7a", "#eda100", "#008300", "#7c3aed", "#06b6d4"];
export const ACCENT = "#4f46e5";
export const CYAN = "#06b6d4";
export const VIOLET = "#7c3aed";

const FONT = "'Geist Variable', system-ui, sans-serif";
const AXIS_LINE = "#e6e8f0";   // đồng bộ --color-border (index.css)
const TEXT = "#565e73";        // đồng bộ --color-text-muted
const TEXT_SUBTLE = "#98a0b3"; // đồng bộ --color-text-subtle

/** Style trục chung (hairline, chữ nhạt). */
export function axisStyle(opts: { numeric?: boolean } = {}) {
  return {
    axisLine: { show: false },
    axisTick: { show: false },
    splitLine: { lineStyle: { color: AXIS_LINE, type: "dashed" as const } },
    axisLabel: {
      color: TEXT_SUBTLE,
      fontSize: 11,
      fontFamily: FONT,
      ...(opts.numeric ? {} : {}),
    },
  };
}

export const TOOLTIP = {
  backgroundColor: "#ffffff",
  borderColor: AXIS_LINE,
  borderWidth: 1,
  padding: [8, 12] as [number, number],
  textStyle: { color: "#0f172a", fontSize: 12, fontFamily: FONT },
  extraCssText: "box-shadow: 0 4px 12px -2px rgb(15 23 42 / 0.12); border-radius: 8px;",
};

export const BASE_TEXT = { color: TEXT, fontFamily: FONT };
export { FONT, AXIS_LINE, TEXT, TEXT_SUBTLE };
