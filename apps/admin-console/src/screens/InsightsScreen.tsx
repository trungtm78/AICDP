import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import type { Insights, ForecastResult } from "../lib/types.js";

const LIFECYCLE_LABEL: Record<string, string> = {
  new: "Mới", active: "Đang hoạt động", at_risk: "Có nguy cơ", vip: "VIP", dormant: "Ngủ đông", churned: "Đã rời", unknown: "Chưa rõ",
};
const LIFECYCLE_COLOR: Record<string, string> = {
  vip: "bg-violet", active: "bg-accent", new: "bg-cyan", at_risk: "bg-warning", dormant: "bg-text-subtle", churned: "bg-error", unknown: "bg-border-strong",
};
const BRAND_LABEL: Record<string, string> = {
  givral: "Givral", kem_trang_tien: "Kem Tràng Tiền", hai_ha_kotobuki: "Hải Hà Kotobuki", fuji: "Fuji Foods", origato: "Origato",
};
const CAT_LABEL: Record<string, string> = { banh: "Bánh", kem: "Kem", do_uong: "Đồ uống", qua_tang: "Quà tặng" };

const fmtInt = new Intl.NumberFormat("vi-VN");
function fmtVnd(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} tỷ`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} tr`;
  return fmtInt.format(n);
}

/** Phân tích chuyên sâu — vòng đời, doanh thu brand, nhóm hàng, synergy, dự báo doanh thu. */
export function InsightsScreen() {
  const ins = useQuery({ queryKey: ["insights"], queryFn: api.getInsights });
  const fc = useQuery({ queryKey: ["forecast"], queryFn: () => api.getForecast({ granularity: "week", periods: 4 }) });

  return (
    <section className="mx-auto max-w-[1120px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Phân tích chuyên sâu</h1>
        <p className="text-text-muted">Hành vi khách hàng, doanh thu, dự báo — tổng hợp từ toàn hệ thống.</p>
      </header>

      {ins.isLoading && <p className="text-text-muted">Đang tải…</p>}
      {ins.isError && <p className="text-error">Không tải được dữ liệu (cần quyền executive/analyst/marketer).</p>}

      {ins.data && (
        <>
          <StatRow data={ins.data} forecast={fc.data} />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <LifecyclePanel data={ins.data} />
            <RevenuePanel data={ins.data} />
            <ForecastPanel fc={fc.data} loading={fc.isLoading} />
            <CategoryPanel data={ins.data} />
          </div>
        </>
      )}
    </section>
  );
}

function StatRow({ data, forecast }: { data: Insights; forecast?: ForecastResult | undefined }) {
  const nextFc = forecast?.forecast[0]?.revenue;
  const tiles = [
    { v: fmtInt.format(data.totalWithFeature), l: "Khách đã phân tích", c: "text-accent" },
    { v: fmtInt.format(data.crossBrandCustomers), l: "Mua ≥2 thương hiệu (synergy)", c: "text-violet" },
    { v: `${Math.round(data.avgChurnRisk * 100)}%`, l: "Churn risk trung bình", c: "text-warning" },
    { v: nextFc !== undefined ? fmtVnd(nextFc) : "—", l: "Dự báo doanh thu kỳ tới", c: "text-cyan" },
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((t, i) => (
        <div key={i} className="rounded-lg border border-border bg-surface p-4">
          <div className={`text-2xl font-bold ${t.c}`}>{t.v}</div>
          <div className="mt-1 text-xs text-text-muted">{t.l}</div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children, testid }: { title: string; children: React.ReactNode; testid?: string }) {
  return (
    <div data-testid={testid} className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Bar({ label, value, max, valueText, color = "bg-accent" }: { label: string; value: number; max: number; valueText: string; color?: string }) {
  const pct = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="mb-2.5">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-text">{label}</span>
        <span className="tabular text-text-muted">{valueText}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-alt">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function LifecyclePanel({ data }: { data: Insights }) {
  const max = Math.max(1, ...data.lifecycle.map((x) => x.count));
  return (
    <Panel title="Phân bố vòng đời khách hàng" testid="panel-lifecycle">
      {data.lifecycle.length === 0 && <p className="text-text-subtle">Chưa có dữ liệu.</p>}
      {data.lifecycle.map((x) => (
        <Bar key={x.stage} label={LIFECYCLE_LABEL[x.stage] ?? x.stage} value={x.count} max={max}
             valueText={`${fmtInt.format(x.count)} khách`} color={LIFECYCLE_COLOR[x.stage] ?? "bg-accent"} />
      ))}
    </Panel>
  );
}

function RevenuePanel({ data }: { data: Insights }) {
  const max = Math.max(1, ...data.revenueByBrand.map((x) => x.revenue));
  return (
    <Panel title="Doanh thu theo thương hiệu" testid="panel-revenue">
      {data.revenueByBrand.length === 0 && <p className="text-text-subtle">Chưa có dữ liệu.</p>}
      {data.revenueByBrand.map((x) => (
        <Bar key={x.brandId} label={BRAND_LABEL[x.brandId] ?? x.brandId} value={x.revenue} max={max}
             valueText={`${fmtVnd(x.revenue)} · ${fmtInt.format(x.transactions)} đơn`} />
      ))}
    </Panel>
  );
}

function CategoryPanel({ data }: { data: Insights }) {
  const max = Math.max(1, ...data.topCategories.map((x) => x.orders));
  return (
    <Panel title="Nhóm hàng phổ biến" testid="panel-category">
      {data.topCategories.length === 0 && <p className="text-text-subtle">Chưa có mapping SKU → nhóm hàng.</p>}
      {data.topCategories.map((x) => (
        <Bar key={x.category} label={CAT_LABEL[x.category] ?? x.category} value={x.orders} max={max}
             valueText={`${fmtInt.format(x.orders)} đơn`} color="bg-cyan" />
      ))}
    </Panel>
  );
}

function ForecastPanel({ fc, loading }: { fc?: ForecastResult | undefined; loading: boolean }) {
  const all = fc ? [...fc.history.map((h) => ({ period: h.period, v: h.revenue, fut: false })),
                    ...fc.forecast.map((f) => ({ period: f.period, v: f.revenue, fut: true }))] : [];
  const max = Math.max(1, ...all.map((x) => x.v));
  return (
    <Panel title="Dự báo doanh thu (theo tuần)" testid="panel-forecast">
      {loading && <p className="text-text-muted">Đang tải…</p>}
      {!loading && all.length === 0 && <p className="text-text-subtle">Chưa đủ dữ liệu để dự báo.</p>}
      {all.length > 0 && (
        <div className="flex h-40 items-end gap-1.5">
          {all.map((x, i) => (
            <div key={i} className="flex flex-1 flex-col items-center justify-end" title={`${x.period}: ${fmtVnd(x.v)}`}>
              <div className={`w-full rounded-t ${x.fut ? "bg-violet/60" : "bg-accent"}`} style={{ height: `${Math.max(4, (x.v / max) * 100)}%` }} />
            </div>
          ))}
        </div>
      )}
      {all.length > 0 && (
        <div className="mt-2 flex gap-4 text-xs text-text-muted">
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" /> Thực tế</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-violet/60" /> Dự báo</span>
        </div>
      )}
    </Panel>
  );
}
