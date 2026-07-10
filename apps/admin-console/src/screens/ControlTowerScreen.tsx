import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Users, Receipt, Wallet, Coins, Send, ShieldAlert, Boxes, RefreshCw, Sparkles, AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api.js";
import type { Overview, ForecastResult } from "../lib/types.js";
import { fmtInt, fmtVnd, LIFECYCLE_LABEL, BRAND_LABEL } from "../lib/format.js";
import {
  PageHeader, StatTile, Panel, Badge, ForecastLine, Donut, BarChart, EmptyState, Skeleton, Sparkline,
} from "../ui/index.js";

/** Control Tower — tổng quan realtime toàn cục đa thương hiệu (số brand động từ API). Refresh mỗi 10s. */
export function ControlTowerScreen() {
  const navigate = useNavigate();
  const ov = useQuery({ queryKey: ["overview"], queryFn: api.getOverview, refetchInterval: 10_000 });
  const ins = useQuery({ queryKey: ["insights"], queryFn: api.getInsights });
  const fc = useQuery({ queryKey: ["forecast", "month"], queryFn: () => api.getForecast({ granularity: "month", periods: 3 }) });

  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <PageHeader
        title="Control Tower"
        description={`Tổng quan toàn cục ${ov.data ? `${ov.data.brands} thương hiệu` : "đa thương hiệu"} — cập nhật mỗi 10 giây.`}
        breadcrumb={["Vận hành", "Control Tower"]}
        badge={
          <Badge tone={ov.isFetching ? "info" : "success"} icon={<RefreshCw className={`size-3 ${ov.isFetching ? "animate-spin" : ""}`} />}>
            {ov.isFetching ? "Đang làm mới" : "Realtime"}
          </Badge>
        }
      />

      {ov.isLoading && <KpiSkeleton />}
      {ov.isError && (
        <EmptyState tone="error" icon={<ShieldAlert className="size-6" />} title="Không tải được tổng quan" description="Kiểm tra core-api (:8071) và quyền truy cập." />
      )}
      {ov.data && <Kpis data={ov.data} forecast={fc.data} />}

      <NarrativePanel />

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <Panel title="Dự báo doanh thu" subtitle="Theo tháng — 3 kỳ tới" className="lg:col-span-2" testid="ct-forecast">
          {fc.isLoading && <Skeleton className="h-56 w-full" />}
          {fc.data && <ForecastPanel fc={fc.data} />}
        </Panel>
        <Panel title="Phân bố vòng đời" subtitle="Khách đã phân tích — bấm để lọc danh bạ" testid="ct-lifecycle">
          {ins.isLoading && <Skeleton className="h-56 w-full" />}
          {ins.data && ins.data.lifecycle.length > 0 ? (
            <Donut
              height={230}
              data={ins.data.lifecycle.map((x) => ({ name: LIFECYCLE_LABEL[x.stage] ?? x.stage, value: x.count }))}
              valueFormatter={(n) => `${fmtInt(n)} khách`}
              onSliceClick={(_, i) => {
                const stage = ins.data?.lifecycle[i]?.stage;
                if (stage) navigate(`/customers?lifecycle=${encodeURIComponent(stage)}`);
              }}
            />
          ) : (
            !ins.isLoading && <EmptyState title="Chưa có dữ liệu vòng đời" />
          )}
        </Panel>
      </div>

      <div className="mt-5">
        <Panel title="Doanh thu theo thương hiệu" subtitle="Tổng hợp toàn hệ thống — bấm để lọc danh bạ" testid="ct-revenue">
          {ins.isLoading && <Skeleton className="h-52 w-full" />}
          {ins.data && ins.data.revenueByBrand.length > 0 ? (
            <BarChart
              height={Math.max(180, ins.data.revenueByBrand.length * 46)}
              data={ins.data.revenueByBrand.map((x) => ({ label: BRAND_LABEL[x.brandId] ?? x.brandId, value: x.revenue }))}
              valueFormatter={fmtVnd}
              onBarClick={(_, i) => {
                const brandId = ins.data?.revenueByBrand[i]?.brandId;
                if (brandId) navigate(`/customers?brand=${encodeURIComponent(brandId)}`);
              }}
            />
          ) : (
            !ins.isLoading && <EmptyState title="Chưa có doanh thu" />
          )}
        </Panel>
      </div>
    </div>
  );
}

/** Auto-narrative (AI/thống kê) + cảnh báo bất thường — tóm tắt tình hình. */
function NarrativePanel() {
  const nav = useNavigate();
  const nq = useQuery({ queryKey: ["narrative"], queryFn: api.getNarrative });
  const aq = useQuery({ queryKey: ["anomalies-ct"], queryFn: api.getAnomalies });
  if (nq.isError) return null;
  const anomalies = aq.data ?? [];
  return (
    <Panel className="mt-6" title="Tóm tắt tình hình (AI)" icon={<Sparkles className="size-4" />}
      actions={nq.data ? <Badge tone={nq.data.source === "llm" ? "accent" : "neutral"}>{nq.data.source === "llm" ? "diễn giải bằng AI" : "tóm tắt tự động"}</Badge> : undefined}>
      {nq.isLoading ? <Skeleton className="h-12 w-full" /> : (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-text">{nq.data?.text}</p>
          {anomalies.length > 0 && (
            <button type="button" onClick={() => nav("/alerts")}
              className="inline-flex items-center gap-1.5 rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-1.5 text-xs text-warning hover:border-warning">
              <AlertTriangle className="size-3.5" /> {anomalies.length} bất thường thống kê — xem chi tiết
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

function Kpis({ data, forecast }: { data: Overview; forecast?: ForecastResult | undefined }) {
  const fcNext = forecast?.forecast[0]?.revenue;
  const hist = forecast?.history.map((h) => h.revenue) ?? [];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <StatTile testid="kpi-revenue" hero label="Doanh thu (VND)" value={fmtInt(data.revenue)} icon={<Wallet className="size-4" />}
        delta={fcNext !== undefined ? `Dự báo kỳ tới ${fmtVnd(fcNext)}` : undefined} />
      <StatTile testid="kpi-customers" label="Khách định danh" value={fmtInt(data.customers)} icon={<Users className="size-4" />} hint={`${data.brands} thương hiệu`} />
      <StatTile testid="kpi-transactions" label="Giao dịch" value={fmtInt(data.transactions)} icon={<Receipt className="size-4" />} hint={`${data.stores} cửa hàng`} />
      <StatTile testid="kpi-loyalty" label="Điểm khả dụng" value={fmtInt(data.loyaltyAvailable)} icon={<Coins className="size-4" />} hint={`${fmtInt(data.loyaltyReserved)} đang giữ`} />
      <StatTile testid="kpi-act-allowed" label="Activation đã gửi" value={fmtInt(data.activationAllowed)} icon={<Send className="size-4" />} deltaTone="up" />
      <StatTile testid="kpi-act-suppressed" label="Bị chặn (consent)" value={fmtInt(data.activationSuppressed)} icon={<ShieldAlert className="size-4" />} deltaTone="down" hint="deny-by-default" />
      <StatTile testid="kpi-master" label="Master data" value={`${data.brands}/${data.stores}/${data.products}`} icon={<Boxes className="size-4" />} hint="brand / store / SP" />
      <StatTile label="Xu hướng doanh thu" value={fmtVnd(hist.length ? hist[hist.length - 1]! : 0)} icon={<Receipt className="size-4" />}
        chart={hist.length > 1 ? <Sparkline data={hist} height={32} /> : undefined} />
    </div>
  );
}

function ForecastPanel({ fc }: { fc: ForecastResult }) {
  if (fc.history.length === 0 && fc.forecast.length === 0) {
    return <EmptyState title="Chưa đủ dữ liệu để dự báo" description="Cần thêm giao dịch theo thời gian." />;
  }
  return (
    <ForecastLine
      height={230}
      history={fc.history.map((h) => ({ period: h.period, value: h.revenue }))}
      forecast={fc.forecast.map((f) => ({ period: f.period, value: f.revenue }))}
      valueFormatter={fmtVnd}
    />
  );
}

function KpiSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-[92px] w-full" />
      ))}
    </div>
  );
}
