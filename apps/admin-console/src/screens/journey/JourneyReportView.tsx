import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, CircleCheck, ShoppingBag, Coins } from "lucide-react";
import { api } from "../../lib/api.js";
import { type JourneyReport } from "../../lib/types.js";
import { fmtInt, fmtVnd } from "../../lib/format.js";
import { Panel, StatTile, Funnel, BarChart, Table, type Column, SegmentedControl, Skeleton, EmptyState, Badge } from "../../ui/index.js";

const NODE_LABEL: Record<string, string> = { entry: "Vào", wait: "Chờ", condition: "Điều kiện", action: "Hành động", exit: "Hoàn thành" };
const WINDOWS = [
  { value: "7", label: "7 ngày" },
  { value: "30", label: "30 ngày" },
  { value: "90", label: "90 ngày" },
];

export function JourneyReportView({ journeyId }: { journeyId: string }) {
  const [win, setWin] = useState("7");
  const q = useQuery({ queryKey: ["journey-report", journeyId, win], queryFn: () => api.jReport(journeyId, Number(win)) });

  if (q.isLoading) return <Skeleton className="h-[60vh] w-full" />;
  const r = q.data;
  if (!r || r.entered === 0) return <EmptyState icon={<Users className="size-6" />} title="Chưa có dữ liệu báo cáo" description="Kích hoạt journey và để khách đi qua các bước." />;

  const a = r.attribution;
  const funnelData = r.funnel.map((f) => ({ name: `${NODE_LABEL[f.nodeType] ?? f.nodeType}: ${f.nodeId}`, value: f.reached }));
  const dayData = r.enrollmentByDay.map((d) => ({ label: d.day.slice(5), value: d.count }));

  const funnelCols: Column<JourneyReport["funnel"][number]>[] = [
    { key: "node", header: "Bước", cell: (f) => <span><Badge tone="neutral">{NODE_LABEL[f.nodeType] ?? f.nodeType}</Badge> <span className="font-mono text-xs text-text-muted">{f.nodeId}</span></span> },
    { key: "reached", header: "Số người tới", numeric: true, cell: (f) => fmtInt(f.reached) },
    { key: "rate", header: "% so với vào", numeric: true, cell: (f) => (r.entered ? `${Math.round((f.reached / r.entered) * 100)}%` : "—") },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-4">
          <StatTile label="Đã vào journey" value={fmtInt(r.entered)} icon={<Users className="size-4" />} hint={`${r.active} đang chạy`} />
          <StatTile label="Hoàn thành" value={fmtInt(r.completed)} icon={<CircleCheck className="size-4" />} deltaTone="up" hint={`${r.failed} lỗi`} />
          <StatTile hero label="Doanh thu quy" value={fmtVnd(a.revenue)} icon={<ShoppingBag className="size-4" />} delta={`${a.orders} đơn · ${a.convertedCustomers} khách`} />
          <StatTile label="Điểm đã cấp" value={fmtInt(a.loyaltyPointsIssued)} icon={<Coins className="size-4" />} hint={`activation: ${a.activationsAllowed} gửi / ${a.activationsSuppressed} chặn`} />
        </div>
      </div>

      <div className="flex items-center justify-end">
        <SegmentedControl items={WINDOWS} value={win} onChange={setWin} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Funnel theo bước" subtitle="Số người tới mỗi node">
          {funnelData.length > 0 ? <Funnel data={funnelData} height={280} valueFormatter={fmtInt} /> : <EmptyState title="Chưa có bước" />}
        </Panel>
        <Panel title="Enrollment theo ngày">
          {dayData.length > 0 ? <BarChart data={dayData} horizontal={false} height={280} valueFormatter={fmtInt} /> : <EmptyState title="Chưa có dữ liệu" />}
        </Panel>
      </div>

      <Panel title="Chuyển đổi từng bước" bodyClassName="p-0">
        <Table columns={funnelCols} rows={r.funnel} rowKey={(f) => f.nodeId} className="rounded-none border-0 shadow-none" density="compact" />
      </Panel>

      {r.exitReasons.length > 0 && (
        <Panel title="Lý do rời / lỗi">
          <div className="flex flex-wrap gap-2">
            {r.exitReasons.map((e) => (
              <Badge key={e.reason} tone="warning">{e.reason}: {e.count}</Badge>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
