import { useQuery } from "@tanstack/react-query";
import { Users, GitCompareArrows, TrendingDown, ChartLine, ShieldAlert } from "lucide-react";
import { api } from "../lib/api.js";
import type { Insights, ForecastResult } from "../lib/types.js";
import { fmtInt, fmtVnd, fmtPct, LIFECYCLE_LABEL, BRAND_LABEL, CAT_LABEL } from "../lib/format.js";
import {
  PageHeader, StatTile, Panel, Donut, BarChart, ForecastLine, EmptyState, Skeleton,
} from "../ui/index.js";
import { CYAN } from "../ui/charts/theme.js";

/** Phân tích chuyên sâu — vòng đời, doanh thu brand, nhóm hàng, dự báo. */
export function InsightsScreen() {
  const ins = useQuery({ queryKey: ["insights"], queryFn: api.getInsights });
  const fc = useQuery({ queryKey: ["forecast", "month"], queryFn: () => api.getForecast({ granularity: "month", periods: 3 }) });

  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <PageHeader
        title="Phân tích chuyên sâu"
        description="Hành vi khách hàng, doanh thu, dự báo — tổng hợp từ toàn hệ thống."
        breadcrumb={["Phân tích", "Chuyên sâu"]}
      />

      {ins.isLoading && <div className="grid grid-cols-2 gap-4 md:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)}</div>}
      {ins.isError && (
        <EmptyState tone="error" icon={<ShieldAlert className="size-6" />} title="Không tải được dữ liệu" description="Cần quyền executive/analyst/marketer và core-api đang chạy." />
      )}

      {ins.data && (
        <>
          <StatRow data={ins.data} forecast={fc.data} />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Panel title="Phân bố vòng đời khách hàng" testid="panel-lifecycle">
              {ins.data.lifecycle.length > 0 ? (
                <Donut
                  data={ins.data.lifecycle.map((x) => ({ name: LIFECYCLE_LABEL[x.stage] ?? x.stage, value: x.count }))}
                  valueFormatter={(n) => `${fmtInt(n)} khách`}
                />
              ) : (
                <EmptyState title="Chưa có dữ liệu" />
              )}
            </Panel>

            <Panel title="Doanh thu theo thương hiệu" testid="panel-revenue">
              {ins.data.revenueByBrand.length > 0 ? (
                <BarChart
                  height={Math.max(200, ins.data.revenueByBrand.length * 44)}
                  data={ins.data.revenueByBrand.map((x) => ({ label: BRAND_LABEL[x.brandId] ?? x.brandId, value: x.revenue }))}
                  valueFormatter={fmtVnd}
                />
              ) : (
                <EmptyState title="Chưa có dữ liệu" />
              )}
            </Panel>

            <Panel title="Dự báo doanh thu (theo tháng)" testid="panel-forecast">
              {fc.isLoading && <Skeleton className="h-56 w-full" />}
              {fc.data && (fc.data.history.length > 0 || fc.data.forecast.length > 0) ? (
                <ForecastLine
                  history={fc.data.history.map((h) => ({ period: h.period, value: h.revenue }))}
                  forecast={fc.data.forecast.map((f) => ({ period: f.period, value: f.revenue }))}
                  valueFormatter={fmtVnd}
                />
              ) : (
                !fc.isLoading && <EmptyState title="Chưa đủ dữ liệu để dự báo" />
              )}
            </Panel>

            <Panel title="Nhóm hàng phổ biến" testid="panel-category">
              {ins.data.topCategories.length > 0 ? (
                <BarChart
                  height={Math.max(200, ins.data.topCategories.length * 44)}
                  data={ins.data.topCategories.map((x) => ({ label: CAT_LABEL[x.category] ?? x.category, value: x.orders }))}
                  valueFormatter={(n) => `${fmtInt(n)} đơn`}
                  color={CYAN}
                />
              ) : (
                <EmptyState title="Chưa có mapping SKU → nhóm hàng" />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function StatRow({ data, forecast }: { data: Insights; forecast?: ForecastResult | undefined }) {
  const nextFc = forecast?.forecast[0]?.revenue;
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile label="Khách đã phân tích" value={fmtInt(data.totalWithFeature)} icon={<Users className="size-4" />} />
      <StatTile label="Mua ≥2 thương hiệu" value={fmtInt(data.crossBrandCustomers)} icon={<GitCompareArrows className="size-4" />} hint="synergy cross-brand" />
      <StatTile label="Churn risk trung bình" value={fmtPct(data.avgChurnRisk)} icon={<TrendingDown className="size-4" />} deltaTone="down" />
      <StatTile hero label="Dự báo doanh thu kỳ tới" value={nextFc !== undefined ? fmtVnd(nextFc) : "—"} icon={<ChartLine className="size-4" />} />
    </div>
  );
}
