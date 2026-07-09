import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { cn } from "../cn.js";
import { useTheme } from "../ThemeProvider.js";

/** Tham số click ECharts (chỉ các trường ta dùng để drill-down). */
export interface EChartClickParams {
  name: string;
  value: unknown;
  dataIndex: number;
  seriesName?: string;
}

export interface EChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
  /** Bắt sự kiện click vào phần tử biểu đồ (slice/bar/point) để drill-down. */
  onClick?: (params: EChartClickParams) => void;
}

/** Wrapper ECharts: renderer SVG (nét, nhẹ), autoresize, remount khi đổi theme. */
export function EChart({ option, height = 260, className, onClick }: EChartProps) {
  const { theme } = useTheme();
  const events = onClick ? { click: (p: EChartClickParams) => onClick(p) } : undefined;
  return (
    <ReactECharts
      key={theme}
      option={option}
      opts={{ renderer: "svg" }}
      notMerge
      style={{ height, width: "100%", cursor: onClick ? "pointer" : "default" }}
      className={cn(className)}
      {...(events ? { onEvents: events } : {})}
    />
  );
}
