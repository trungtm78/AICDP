import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { Overview } from "../lib/types.js";

const nf = new Intl.NumberFormat("vi-VN");

/** Control Tower — tổng quan realtime (KPI tổng hợp từ analytics). Refresh mỗi 10s. */
export function ControlTowerScreen() {
  const q = useQuery({
    queryKey: ["overview"],
    queryFn: api.getOverview,
    refetchInterval: 10_000,
  });

  return (
    <section className="mx-auto max-w-[1200px] p-6">
      <header className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Control Tower</h1>
          <p className="text-text-muted">Tổng quan toàn cục 5 thương hiệu — cập nhật mỗi 10 giây.</p>
        </div>
        {q.isFetching && <span className="text-xs text-text-subtle">đang làm mới…</span>}
      </header>

      {q.isLoading && <p className="text-text-muted">Đang tải…</p>}
      {q.isError && <p className="text-error">Lỗi tải tổng quan.</p>}

      {q.data && <Tiles data={q.data} />}
    </section>
  );
}

function Tiles({ data }: { data: Overview }) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi testid="kpi-customers" label="Khách định danh" value={nf.format(data.customers)} />
        <Kpi testid="kpi-transactions" label="Giao dịch" value={nf.format(data.transactions)} />
        <Kpi
          testid="kpi-revenue"
          label="Doanh thu (VND)"
          value={nf.format(data.revenue)}
          accent="text-accent"
        />
        <Kpi
          testid="kpi-loyalty"
          label="Điểm khả dụng"
          value={nf.format(data.loyaltyAvailable)}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi testid="kpi-reserved" label="Điểm đang giữ" value={nf.format(data.loyaltyReserved)} />
        <Kpi
          testid="kpi-act-allowed"
          label="Activation gửi"
          value={nf.format(data.activationAllowed)}
          accent="text-success"
        />
        <Kpi
          testid="kpi-act-suppressed"
          label="Bị chặn (consent)"
          value={nf.format(data.activationSuppressed)}
          accent="text-warning"
        />
        <Kpi
          testid="kpi-master"
          label="Brand / Store / SP"
          value={`${data.brands} / ${data.stores} / ${data.products}`}
        />
      </div>
    </div>
  );
}

function Kpi(props: { testid: string; label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-text-subtle">{props.label}</div>
      <div className={`tabular mt-1 text-2xl font-bold ${props.accent ?? ""}`} data-testid={props.testid}>
        {props.value}
      </div>
    </div>
  );
}
