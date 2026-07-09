import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert, TrendingUp, TrendingDown, Check } from "lucide-react";
import { api } from "../lib/api.js";
import { type AnalyticsAlert } from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import {
  PageHeader, Panel, Table, Badge, Button, StatusPill, SegmentedControl, Skeleton, EmptyState, AnomalyLine, type Column,
} from "../ui/index.js";

const METRICS = [
  { value: "revenue_weekly", label: "Doanh thu/tuần" },
  { value: "orders_weekly", label: "Số đơn/tuần" },
  { value: "new_customers_weekly", label: "Khách mới/tuần" },
];
const METRIC_LABEL: Record<string, string> = {
  revenue_weekly: "Doanh thu theo tuần", orders_weekly: "Số đơn theo tuần", new_customers_weekly: "Khách mới theo tuần",
};
const SEV_TONE: Record<string, "warning" | "error" | "neutral"> = { warning: "warning", critical: "error", info: "neutral" };

/** Cảnh báo bất thường (Analytics Intelligence) — z-score trên chuỗi thời gian. */
export function AlertsScreen() {
  const qc = useQueryClient();
  const [metric, setMetric] = useState("revenue_weekly");
  // detectAnomalies chạy để upsert alert; listAlerts đọc lịch sử.
  useQuery({ queryKey: ["anomalies-run"], queryFn: api.getAnomalies });
  const seriesQ = useQuery({ queryKey: ["metric-series", metric], queryFn: () => api.getMetricSeries(metric) });
  const alertsQ = useQuery({ queryKey: ["alerts"], queryFn: api.getAlerts });

  const ack = useMutation({
    mutationFn: (id: string) => api.ackAlert(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const anomalyPeriods = (seriesQ.data?.anomalies ?? []).map((a) => a.period);

  const cols: Column<AnalyticsAlert>[] = [
    { key: "metric", header: "Chỉ số", cell: (a) => <span className="text-text-muted">{METRIC_LABEL[a.metric] ?? a.metric}</span> },
    { key: "period", header: "Kỳ", width: "100px", cell: (a) => <span className="font-mono text-xs">{a.period}</span> },
    { key: "value", header: "Giá trị", numeric: true, width: "120px", cell: (a) => <span className="font-semibold tabular">{fmtInt(a.value)}</span> },
    { key: "expected", header: "Kỳ vọng", numeric: true, width: "110px", cell: (a) => <span className="tabular text-text-subtle">{fmtInt(a.expected)}</span> },
    { key: "z", header: "z-score", numeric: true, width: "90px", cell: (a) => <span className="tabular">{a.zscore.toFixed(2)}</span> },
    { key: "dir", header: "", width: "44px", cell: (a) => a.direction === "up" ? <TrendingUp className="size-4 text-success" /> : <TrendingDown className="size-4 text-error" /> },
    { key: "sev", header: "Mức", width: "100px", cell: (a) => <StatusPill tone={SEV_TONE[a.severity] ?? "neutral"}>{a.severity}</StatusPill> },
    {
      key: "ack", header: "", numeric: true, width: "120px",
      cell: (a) => a.acknowledged
        ? <Badge tone="neutral">đã xử lý</Badge>
        : <Button size="sm" variant="ghost" icon={<Check className="size-3.5" />} onClick={() => a.id && ack.mutate(a.id)}>Ghi nhận</Button>,
    },
  ];

  return (
    <div className="mx-auto max-w-[1180px] p-6">
      <PageHeader
        title="Cảnh báo bất thường"
        description="Phát hiện thống kê (z-score) trên chuỗi thời gian doanh thu / đơn / khách mới. |z|≥2 cảnh báo, |z|≥3 nghiêm trọng."
        breadcrumb={["Vận hành", "Cảnh báo"]}
        badge={<Badge tone="neutral">phát hiện thống kê (z-score)</Badge>}
      />

      <div className="mb-4"><SegmentedControl items={METRICS} value={metric} onChange={setMetric} /></div>

      <Panel title={METRIC_LABEL[metric]} subtitle="Điểm ghim đỏ = bất thường" icon={<TriangleAlert className="size-4" />} className="mb-5">
        {seriesQ.isLoading ? <Skeleton className="h-64 w-full" /> : (seriesQ.data?.points.length ?? 0) > 0
          ? <AnomalyLine height={280} data={seriesQ.data!.points} anomalyPeriods={anomalyPeriods} valueFormatter={fmtInt} />
          : <EmptyState title="Chưa đủ dữ liệu chuỗi thời gian" />}
      </Panel>

      <Panel title="Danh sách cảnh báo" subtitle={`${fmtInt(alertsQ.data?.length ?? 0)} cảnh báo`} bodyClassName="p-0">
        <Table columns={cols} rows={alertsQ.data ?? []} rowKey={(a) => a.id ?? `${a.metric}-${a.period}`} loading={alertsQ.isLoading}
          empty={{ title: "Không có bất thường", description: "Các chỉ số đang trong ngưỡng bình thường." }} density="compact" />
      </Panel>
    </div>
  );
}
