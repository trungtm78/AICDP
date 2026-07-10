import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, GitCompareArrows, TrendingDown, ChartLine, ShieldAlert } from "lucide-react";
import { api } from "../lib/api.js";
import type { Insights, ForecastResult, Funnel as FunnelData } from "../lib/types.js";
import { fmtInt, fmtVnd, fmtVndFull, fmtPct, LIFECYCLE_LABEL, BRAND_LABEL, CAT_LABEL } from "../lib/format.js";
import {
  PageHeader, StatTile, Panel, Donut, BarChart, ForecastLine, Heatmap, Sankey, Funnel,
  Tabs, SegmentedControl, EmptyState, Skeleton, Badge, Table, type Column,
} from "../ui/index.js";
import { CYAN } from "../ui/charts/theme.js";

/** Phân tích chuyên sâu — tổng quan + attribution/cohort/RFM/funnel. */
export function InsightsScreen() {
  const [tab, setTab] = useState("overview");
  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <PageHeader
        title="Phân tích chuyên sâu"
        description="Hành vi khách hàng, doanh thu, dự báo, attribution, cohort, RFM, funnel."
        breadcrumb={["Phân tích", "Chuyên sâu"]}
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} items={[
        { value: "overview", label: "Tổng quan" },
        { value: "attribution", label: "Attribution" },
        { value: "cohort", label: "Cohort / Retention" },
        { value: "rfm", label: "RFM matrix" },
        { value: "funnel", label: "Funnel" },
      ]} />
      {tab === "overview" && <OverviewTab />}
      {tab === "attribution" && <AttributionTab />}
      {tab === "cohort" && <CohortTab />}
      {tab === "rfm" && <RfmTab />}
      {tab === "funnel" && <FunnelTab />}
    </div>
  );
}

function OverviewTab() {
  const ins = useQuery({ queryKey: ["insights"], queryFn: api.getInsights });
  const fc = useQuery({ queryKey: ["forecast", "month"], queryFn: () => api.getForecast({ granularity: "month", periods: 3 }) });

  return (
    <>
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
    </>
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

const ATTR_MODELS = [
  { value: "first", label: "First-touch" },
  { value: "last", label: "Last-touch" },
  { value: "linear", label: "Linear" },
];
function AttributionTab() {
  const [model, setModel] = useState("last");
  const q = useQuery({ queryKey: ["attribution", model], queryFn: () => api.getAttribution(model) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">Doanh thu quy cho journey (đã enroll → có giao dịch sau đó).</p>
        <SegmentedControl items={ATTR_MODELS} value={model} onChange={setModel} />
      </div>
      {q.isLoading ? <Skeleton className="h-72 w-full" /> : !d || d.journeys.length === 0 ? (
        <EmptyState title="Chưa có dữ liệu attribution" description="Cần journey có người tham gia + giao dịch sau enroll." />
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Panel title="Doanh thu quy theo journey" subtitle={`Tổng ${fmtVndFull(d.totalRevenue)}`}>
            <BarChart height={Math.max(200, d.journeys.length * 44)} data={d.journeys.map((j) => ({ label: j.name, value: j.attributedRevenue }))} valueFormatter={fmtVnd} />
          </Panel>
          <Panel title="Luồng đóng góp (journey → doanh thu)">
            <Sankey height={Math.max(220, d.journeys.length * 50)}
              nodes={[...d.journeys.map((j) => ({ name: j.name })), { name: "Doanh thu" }]}
              links={d.journeys.map((j) => ({ source: j.name, target: "Doanh thu", value: j.attributedRevenue }))}
              valueFormatter={fmtVnd} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function CohortTab() {
  const q = useQuery({ queryKey: ["cohorts"], queryFn: api.getCohorts });
  const d = q.data;
  if (q.isLoading) return <Skeleton className="h-80 w-full" />;
  if (!d || d.cohorts.length === 0) return <EmptyState title="Chưa đủ dữ liệu cohort" />;
  const xLabels = Array.from({ length: d.maxOffset + 1 }, (_, i) => `+${i}`);
  const yLabels = d.cohorts.map((c) => `${c.cohort} (${c.size})`);
  const cells: [number, number, number][] = [];
  d.cohorts.forEach((c, y) => c.retention.forEach((r, x) => { if (r !== null) cells.push([x, y, Math.round(r * 100)]); }));
  return (
    <Panel title="Cohort retention (%)" subtitle="Cohort = tháng mua đầu · offset = tháng sau đó" icon={<Users className="size-4" />}>
      <Heatmap xLabels={xLabels} yLabels={yLabels} cells={cells} height={Math.max(260, d.cohorts.length * 40)} valueFormatter={(n) => `${n}%`} />
    </Panel>
  );
}

function RfmTab() {
  const q = useQuery({ queryKey: ["rfm"], queryFn: api.getRfmMatrix });
  const d = q.data;
  if (q.isLoading) return <Skeleton className="h-80 w-full" />;
  if (!d || d.total === 0) return <EmptyState title="Chưa đủ dữ liệu RFM" />;
  return (
    <Panel title="RFM matrix (Recency × Frequency)" subtitle={`${fmtInt(d.total)} khách · ngũ phân vị`} icon={<GitCompareArrows className="size-4" />}>
      <Heatmap xLabels={d.fLabels} yLabels={d.rLabels} cells={d.cells} height={320} valueFormatter={fmtInt} />
      <p className="mt-2 text-xs text-text-subtle">Ô sáng góc trên-phải (gần đây + mua nhiều) = khách giá trị cao; góc dưới (xa) = cần win-back.</p>
    </Panel>
  );
}

function FunnelTab() {
  const q = useQuery({ queryKey: ["funnel"], queryFn: () => api.getFunnel() });
  const d = q.data;
  if (q.isLoading) return <Skeleton className="h-72 w-full" />;
  if (!d || d.steps.length === 0) return <EmptyState title="Chưa có dữ liệu funnel" />;
  const cols: Column<FunnelData["steps"][number]>[] = [
    { key: "label", header: "Bước", cell: (s) => <span className="font-medium text-text">{s.label}</span> },
    { key: "count", header: "Số khách", numeric: true, width: "120px", cell: (s) => fmtInt(s.count) },
    { key: "pct", header: "% tổng", numeric: true, width: "100px", cell: (s) => <Badge tone="accent">{s.pct}%</Badge> },
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Phễu chuyển đổi khách hàng" icon={<TrendingDown className="size-4" />}>
        <Funnel height={300} data={d.steps.map((s) => ({ name: s.label, value: s.count }))} valueFormatter={fmtInt} />
      </Panel>
      <Panel title="Chi tiết từng bước" bodyClassName="p-0">
        <Table columns={cols} rows={d.steps} rowKey={(s) => s.key} density="compact" />
      </Panel>
    </div>
  );
}
