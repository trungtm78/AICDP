import type { EChartsOption } from "echarts";
import { EChart } from "./EChart.js";
import { useTheme } from "../ThemeProvider.js";
import { chartTokens, tooltip, vizPalette, axisStyle, areaColor, heatmapRange, FONT } from "./theme.js";

type Fmt = (n: number) => string;
const idFmt: Fmt = (n) => String(n);

export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

/** Bar chart — mặc định ngang (dễ đọc nhãn dài), có thể dọc. */
export function BarChart({
  data,
  height = 260,
  horizontal = true,
  valueFormatter = idFmt,
  color,
}: {
  data: BarDatum[];
  height?: number;
  horizontal?: boolean;
  valueFormatter?: Fmt;
  color?: string;
}) {
  useTheme();
  const T = chartTokens();
  const barColor = color ?? T.accent;
  const labels = data.map((d) => d.label);
  const values = data.map((d) => ({ value: d.value, ...(d.color ? { itemStyle: { color: d.color } } : {}) }));
  const catAxis = { type: "category" as const, data: labels, ...axisStyle() };
  const valAxis = { type: "value" as const, ...axisStyle({ numeric: true }), axisLabel: { ...axisStyle().axisLabel, formatter: (v: number) => valueFormatter(v) } };

  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
    tooltip: { trigger: "item", ...tooltip(), valueFormatter: (v) => valueFormatter(Number(v)) },
    xAxis: horizontal ? valAxis : catAxis,
    yAxis: horizontal ? { ...catAxis, inverse: true } : valAxis,
    series: [
      {
        type: "bar",
        data: values,
        barMaxWidth: 22,
        itemStyle: { color: barColor, borderRadius: horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0] },
        label: {
          show: true,
          position: horizontal ? "right" : "top",
          formatter: (p) => valueFormatter(Number(p.value)),
          color: T.text,
          fontSize: 11,
          fontFamily: FONT,
        },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

export interface DonutSlice {
  name: string;
  value: number;
  color?: string;
}

/** Donut — phân bố (vòng đời, tỉ trọng). */
export function Donut({
  data,
  height = 260,
  valueFormatter = idFmt,
  centerLabel,
}: {
  data: DonutSlice[];
  height?: number;
  valueFormatter?: Fmt;
  centerLabel?: string;
}) {
  useTheme();
  const T = chartTokens();
  const option: EChartsOption = {
    color: vizPalette(),
    tooltip: { trigger: "item", ...tooltip(), valueFormatter: (v) => valueFormatter(Number(v)) },
    legend: {
      orient: "vertical",
      right: 0,
      top: "center",
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: T.text, fontSize: 12, fontFamily: FONT },
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "82%"],
        center: ["34%", "50%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: T.surface, borderWidth: 2 },
        label: centerLabel
          ? { show: true, position: "center", formatter: centerLabel, fontSize: 12, color: T.text, fontFamily: FONT }
          : { show: false },
        labelLine: { show: false },
        data: data.map((d) => ({ name: d.name, value: d.value, ...(d.color ? { itemStyle: { color: d.color } } : {}) })),
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

/** Line + Area cho forecast: phần lịch sử (liền) + dự báo (đứt). */
export function ForecastLine({
  history,
  forecast,
  height = 260,
  valueFormatter = idFmt,
}: {
  history: { period: string; value: number }[];
  forecast: { period: string; value: number }[];
  height?: number;
  valueFormatter?: Fmt;
}) {
  useTheme();
  const T = chartTokens();
  const periods = [...history.map((h) => h.period), ...forecast.map((f) => f.period)];
  const histVals: (number | null)[] = history.map((h) => h.value);
  const lastHist = history.length ? history[history.length - 1]!.value : null;
  const foreVals: (number | null)[] = [...history.map(() => null), ...forecast.map((f) => f.value)];
  if (history.length > 0) foreVals[history.length - 1] = lastHist;

  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
    tooltip: { trigger: "axis", ...tooltip(), valueFormatter: (v) => (v == null ? "" : valueFormatter(Number(v))) },
    legend: {
      right: 0,
      top: 0,
      icon: "roundRect",
      itemWidth: 12,
      itemHeight: 4,
      textStyle: { color: T.text, fontSize: 11, fontFamily: FONT },
      data: ["Thực tế", "Dự báo"],
    },
    xAxis: { type: "category", boundaryGap: false, data: periods, ...axisStyle() },
    yAxis: { type: "value", ...axisStyle({ numeric: true }), axisLabel: { ...axisStyle().axisLabel, formatter: (v: number) => valueFormatter(v) } },
    series: [
      {
        name: "Thực tế",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        data: histVals,
        lineStyle: { width: 2.5, color: T.accent },
        itemStyle: { color: T.accent },
        areaStyle: { color: areaColor("accent") },
      },
      {
        name: "Dự báo",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 6,
        data: foreVals,
        lineStyle: { width: 2.5, type: "dashed", color: T.violet },
        itemStyle: { color: T.violet },
        areaStyle: { color: areaColor("violet") },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

export interface FunnelStage {
  name: string;
  value: number;
}

/** Funnel — phễu chuyển đổi (journey). */
export function Funnel({ data, height = 260, valueFormatter = idFmt }: { data: FunnelStage[]; height?: number; valueFormatter?: Fmt }) {
  useTheme();
  const T = chartTokens();
  const option: EChartsOption = {
    color: vizPalette(),
    tooltip: { trigger: "item", ...tooltip(), valueFormatter: (v) => valueFormatter(Number(v)) },
    series: [
      {
        type: "funnel",
        left: 8,
        right: 8,
        top: 8,
        bottom: 8,
        minSize: "24%",
        gap: 3,
        // Chữ trắng + halo tối → đọc được trên mọi màu segment (light lẫn dark palette).
        label: { color: "#fff", textBorderColor: "rgba(2,6,23,0.6)", textBorderWidth: 2, fontSize: 12, fontFamily: FONT, formatter: "{b}: {c}" },
        itemStyle: { borderColor: T.surface, borderWidth: 1 },
        data,
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

/** Heatmap — cohort/ma trận (vd synergy brand×brand). */
export function Heatmap({
  xLabels,
  yLabels,
  cells,
  height = 300,
  valueFormatter = idFmt,
}: {
  xLabels: string[];
  yLabels: string[];
  /** [xIndex, yIndex, value] */
  cells: [number, number, number][];
  height?: number;
  valueFormatter?: Fmt;
}) {
  useTheme();
  const T = chartTokens();
  const max = cells.reduce((m, c) => Math.max(m, c[2]), 0);
  const option: EChartsOption = {
    grid: { left: 8, right: 16, top: 8, bottom: 48, containLabel: true },
    tooltip: { ...tooltip(), position: "top", valueFormatter: (v) => valueFormatter(Number(v)) },
    xAxis: { type: "category", data: xLabels, splitArea: { show: true }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.subtle, fontSize: 11, fontFamily: FONT } },
    yAxis: { type: "category", data: yLabels, splitArea: { show: true }, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.subtle, fontSize: 11, fontFamily: FONT } },
    visualMap: {
      min: 0,
      max: max || 1,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 4,
      inRange: { color: heatmapRange() },
      textStyle: { color: T.subtle, fontSize: 10, fontFamily: FONT },
    },
    series: [
      {
        type: "heatmap",
        data: cells,
        // Chữ trắng + halo tối → đọc được trên mọi ô (thang màu từ nhạt→đậm, cả 2 theme).
        label: {
          show: true,
          color: "#fff",
          textBorderColor: "rgba(2,6,23,0.65)",
          textBorderWidth: 2,
          fontSize: 10,
          fontFamily: FONT,
          formatter: (p) => {
            const arr = p.value as number[];
            return arr && arr[2] ? valueFormatter(arr[2]) : "";
          },
        },
        itemStyle: { borderColor: T.surface, borderWidth: 2, borderRadius: 4 },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

export interface SankeyNode {
  name: string;
}
export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

/** Sankey — luồng chuyển giữa các nhóm (synergy cross-brand). */
export function Sankey({
  nodes,
  links,
  height = 320,
  valueFormatter = idFmt,
}: {
  nodes: SankeyNode[];
  links: SankeyLink[];
  height?: number;
  valueFormatter?: Fmt;
}) {
  useTheme();
  const T = chartTokens();
  const option: EChartsOption = {
    color: vizPalette(),
    tooltip: { trigger: "item", ...tooltip(), valueFormatter: (v) => valueFormatter(Number(v)) },
    series: [
      {
        type: "sankey",
        left: 8,
        right: 8,
        top: 12,
        bottom: 12,
        nodeGap: 14,
        nodeWidth: 12,
        draggable: false,
        emphasis: { focus: "adjacency" },
        data: nodes,
        links,
        label: { color: T.text, fontSize: 11, fontFamily: FONT },
        lineStyle: { color: "gradient", opacity: 0.35, curveness: 0.5 },
        itemStyle: { borderWidth: 0 },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}

/** Sparkline nhỏ cho StatTile. */
export function Sparkline({ data, color, height = 36 }: { data: number[]; color?: string; height?: number }) {
  useTheme();
  const T = chartTokens();
  const line = color ?? T.cyan;
  const option: EChartsOption = {
    grid: { left: 0, right: 0, top: 2, bottom: 2 },
    xAxis: { type: "category", show: false, boundaryGap: false, data: data.map((_, i) => i) },
    yAxis: { type: "value", show: false, min: "dataMin", max: "dataMax" },
    tooltip: { show: false },
    series: [
      {
        type: "line",
        data,
        smooth: true,
        symbol: "none",
        lineStyle: { width: 2, color: line },
        areaStyle: { color: "rgba(34,211,238,0.12)" },
      },
    ],
  };
  return <EChart option={option} height={height} />;
}
