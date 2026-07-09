import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { cn } from "../cn.js";
import { useTheme } from "../ThemeProvider.js";

export interface EChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
}

/** Wrapper ECharts: renderer SVG (nét, nhẹ), autoresize, remount khi đổi theme. */
export function EChart({ option, height = 260, className }: EChartProps) {
  const { theme } = useTheme();
  return (
    <ReactECharts
      key={theme}
      option={option}
      opts={{ renderer: "svg" }}
      notMerge
      style={{ height, width: "100%" }}
      className={cn(className)}
    />
  );
}
