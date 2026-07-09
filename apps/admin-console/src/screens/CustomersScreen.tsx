import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, UserRound, ShieldAlert, UserX, Sparkles, Target, ShoppingBag, ArrowLeft, Gem, Crown, Medal, Award } from "lucide-react";
import { api } from "../lib/api.js";
import {
  ApiError,
  type Customer360,
  type CustomerListItem,
  type CustomerAnalytics,
  type IdentifierType,
  type Recommendation,
  type CustomerFeature,
  type NbaDecision,
  type LifecycleStage,
} from "../lib/types.js";
import { CustomerDeepAnalytics } from "./CustomerAnalyticsPanels.js";
import { fmtInt, fmtVndFull, LIFECYCLE_LABEL, customerTier } from "../lib/format.js";
import {
  PageHeader, Toolbar, Panel, Button, Field, Select, Input, Badge, StatusPill,
  EmptyState, Table, type Column, Skeleton,
} from "../ui/index.js";

const LIFECYCLE_TONE: Record<LifecycleStage, "success" | "warning" | "error" | "accent" | "neutral"> = {
  vip: "success", active: "accent", new: "neutral", at_risk: "warning", dormant: "warning", churned: "error",
};
const PAGE_SIZE = 12;

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "notfound" }
  | { kind: "error"; message: string }
  | { kind: "success"; data: Customer360 };

const TYPES: { value: IdentifierType; label: string }[] = [
  { value: "phone", label: "Số điện thoại" },
  { value: "email", label: "Email" },
  { value: "loyalty_card", label: "Thẻ loyalty" },
  { value: "pos_member_id", label: "POS member ID" },
];

/** Customer 360 — tra cứu 1 khách theo identifier. Data 100% từ core-api. */
export function CustomersScreen() {
  const [type, setType] = useState<IdentifierType>("phone");
  const [value, setValue] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [feature, setFeature] = useState<CustomerFeature | null>(null);
  const [analytics, setAnalytics] = useState<CustomerAnalytics | null>(null);
  const [nba, setNba] = useState<NbaDecision | null>(null);
  const [explain, setExplain] = useState<string | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const reqId = useRef(0);

  async function load(fetcher: () => Promise<Customer360>) {
    const myReq = ++reqId.current;
    setView({ kind: "loading" });
    setRecs([]);
    setFeature(null);
    setAnalytics(null);
    setNba(null);
    setExplain(null);
    try {
      const data = await fetcher();
      if (myReq !== reqId.current) return;
      setView({ kind: "success", data });
      try {
        const an = await api.getCustomerAnalytics(data.occId);
        if (myReq === reqId.current) setAnalytics(an);
      } catch { /* bỏ qua */ }
      try {
        const r = await api.getRecommendations(data.occId);
        if (myReq === reqId.current) setRecs(r.recommendations);
      } catch {
        if (myReq === reqId.current) setRecs([]);
      }
      try {
        const f = await api.recomputeFeature(data.occId);
        if (myReq === reqId.current) setFeature(f);
      } catch { /* bỏ qua */ }
      try {
        const d = await api.getNba(data.occId);
        if (myReq === reqId.current) setNba(d);
      } catch { /* bỏ qua */ }
    } catch (err) {
      if (myReq !== reqId.current) return;
      if (err instanceof ApiError && err.code === "CUSTOMER_NOT_FOUND") {
        setView({ kind: "notfound" });
      } else {
        setView({ kind: "error", message: err instanceof Error ? err.message : "Lỗi không xác định" });
      }
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    void load(() => api.lookupCustomer(type, value.trim()));
  }

  const showDetail = view.kind !== "idle";

  return (
    <div className="mx-auto max-w-[1120px] p-6">
      <PageHeader
        title="Khách hàng — Customer 360"
        description="Duyệt danh bạ khách hàng hợp nhất hoặc tra cứu theo định danh (xuyên thương hiệu)."
        breadcrumb={["Vận hành", "Customers"]}
      />

      <form onSubmit={onSubmit}>
        <Toolbar>
          <Field className="w-44" label="Loại định danh">
            <Select aria-label="Loại định danh" value={type} onChange={(e) => setType(e.target.value as IdentifierType)}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field className="min-w-[240px] flex-1" label="Giá trị định danh">
            <Input aria-label="Giá trị định danh" value={value} onChange={(e) => setValue(e.target.value)}
              placeholder="vd 0901234567" className="font-mono" icon={<Search className="size-4" />} />
          </Field>
          <Button type="submit" variant="primary" disabled={!value.trim() || view.kind === "loading"} loading={view.kind === "loading"} className="mb-[1px]">
            Tra cứu
          </Button>
        </Toolbar>
      </form>

      {/* Danh bạ khách hàng — hiển thị khi chưa tra cứu chi tiết */}
      {!showDetail && (
        <CustomerDirectory onOpen={(occId) => void load(() => api.getCustomerByOcc(occId))} />
      )}

      <div className="mt-2">
        {view.kind === "loading" && <Skeleton className="h-48 w-full" />}
        {view.kind === "notfound" && (
          <EmptyState icon={<UserX className="size-6" />} title="Không tìm thấy khách hàng" description="Định danh chưa gắn với OCH ID nào — khách có thể chưa phát sinh giao dịch." />
        )}
        {view.kind === "error" && (
          <EmptyState tone="error" icon={<ShieldAlert className="size-6" />} title="Lỗi tra cứu" description={view.message} />
        )}
        {view.kind === "success" && (
          <div className="space-y-5">
            <button type="button" onClick={() => setView({ kind: "idle" })}
              className="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-accent">
              <ArrowLeft className="size-4" /> Về danh bạ khách hàng
            </button>
            <CustomerCard data={view.data} />
            {feature && (
              <AiBehaviorPanel
                feature={feature}
                nba={nba}
                explain={explain}
                explainBusy={explainBusy}
                onExplain={async () => {
                  setExplainBusy(true);
                  try {
                    const r = await api.assistantExplain(feature.occId);
                    setExplain(r.text);
                  } catch (e) {
                    setExplain(e instanceof ApiError ? `Lỗi: ${e.message}` : "Lỗi diễn giải");
                  } finally {
                    setExplainBusy(false);
                  }
                }}
              />
            )}
            {analytics && feature && (
              <CustomerDeepAnalytics analytics={analytics} feature={feature} totalSpend={analytics.summary.totalSpend} />
            )}
            {recs.length > 0 && <CrossSell recs={recs} />}
          </div>
        )}
      </div>
    </div>
  );
}

const LIFECYCLE_FILTER: { value: string; label: string }[] = [
  { value: "", label: "Tất cả vòng đời" },
  { value: "vip", label: "VIP" },
  { value: "active", label: "Đang hoạt động" },
  { value: "new", label: "Mới" },
  { value: "at_risk", label: "Có nguy cơ" },
  { value: "dormant", label: "Ngủ đông" },
  { value: "churned", label: "Đã rời" },
];

const TIER_ICON = { diamond: Gem, gold: Crown, silver: Medal, bronze: Award } as const;

/** Huy hiệu hạng khách hàng (Kim cương/Vàng/Bạc/Đồng) — có icon + màu kim loại. */
function TierBadge({ spend, size = "sm" }: { spend: number; size?: "sm" | "lg" }) {
  const t = customerTier(spend);
  const Icon = TIER_ICON[t.key];
  const lg = size === "lg";
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold ${lg ? "gap-2 px-3.5 py-1 text-sm" : "gap-1.5 px-2.5 py-0.5 text-xs"}`}
      style={{ backgroundColor: `${t.color}1f`, color: t.color, border: `1px solid ${t.color}66` }}
      title={`Hạng ${t.label} · tổng chi tiêu ${fmtVndFull(spend)}`}
    >
      <Icon className={lg ? "size-4" : "size-3.5"} strokeWidth={2.2} />
      {t.label}
    </span>
  );
}

/** Danh bạ khách hàng — duyệt + lọc + phân trang; click 1 dòng để mở Customer 360. */
function CustomerDirectory({ onOpen }: { onOpen: (occId: string) => void }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [page, setPage] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  // debounce ô tìm kiếm (350ms)
  function onSearchChange(v: string) {
    setSearch(v);
    setPage(0);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(v.trim()), 350);
  }

  const q = useQuery({
    queryKey: ["customers", debounced, lifecycle, page],
    queryFn: () =>
      api.listCustomers({
        ...(debounced ? { search: debounced } : {}),
        ...(lifecycle ? { lifecycle } : {}),
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });
  const rows = q.data?.data ?? [];
  const total = q.data?.meta.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  const columns: Column<CustomerListItem>[] = [
    {
      key: "name", header: "Khách hàng",
      cell: (c) => (
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg brand-gradient text-xs font-bold text-white">
            {(c.fullName ?? "?").trim().slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="truncate font-medium text-text">{c.fullName ?? "(chưa có tên)"}</div>
            <div className="truncate font-mono text-[11px] text-text-subtle">{c.occId}</div>
          </div>
        </div>
      ),
    },
    { key: "city", header: "Thành phố", cell: (c) => c.city ?? "—", width: "120px" },
    { key: "tier", header: "Hạng", width: "120px", cell: (c) => <TierBadge spend={c.monetary} /> },
    {
      key: "lifecycle", header: "Vòng đời", width: "130px",
      cell: (c) => c.lifecycleStage
        ? <Badge tone={LIFECYCLE_TONE[c.lifecycleStage]}>{LIFECYCLE_LABEL[c.lifecycleStage] ?? c.lifecycleStage}</Badge>
        : <span className="text-text-subtle">—</span>,
    },
    { key: "brands", header: "TH", numeric: true, cell: (c) => fmtInt(c.distinctBrands), width: "70px" },
    { key: "freq", header: "Đơn", numeric: true, cell: (c) => fmtInt(c.frequency), width: "80px" },
    { key: "monetary", header: "Chi tiêu", numeric: true, cell: (c) => <span className="font-semibold">{fmtVndFull(c.monetary)}</span>, width: "140px" },
    { key: "loyalty", header: "Điểm", numeric: true, cell: (c) => fmtInt(c.loyaltyAvailable), width: "90px" },
  ];

  return (
    <Panel className="mt-2" title="Danh bạ khách hàng" icon={<UserRound className="size-4" />}
      subtitle={`${fmtInt(total)} khách hàng hợp nhất`} bodyClassName="p-0">
      <div className="flex flex-wrap items-end gap-3 border-b border-border p-4">
        <Field className="min-w-[260px] flex-1" label="Tìm theo tên / SĐT / email">
          <Input aria-label="Tìm khách hàng" value={search} onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Nguyễn Văn A / 09… / @gmail…" icon={<Search className="size-4" />} />
        </Field>
        <Field className="w-48" label="Vòng đời">
          <Select aria-label="Lọc vòng đời" value={lifecycle} onChange={(e) => { setLifecycle(e.target.value); setPage(0); }}>
            {LIFECYCLE_FILTER.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </Select>
        </Field>
      </div>
      {q.isError && <p className="p-4 text-sm text-error">Lỗi tải danh sách khách hàng.</p>}
      <Table
        columns={columns}
        rows={rows}
        rowKey={(c) => c.occId}
        loading={q.isLoading}
        onRowClick={(c) => onOpen(c.occId)}
        empty={{ title: "Không có khách hàng", description: "Thử đổi bộ lọc hoặc từ khoá tìm kiếm." }}
        density="compact"
      />
      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
          <span className="text-text-muted">Trang {page + 1}/{maxPage + 1}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Trước</Button>
            <Button size="sm" variant="secondary" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>Sau</Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function CustomerCard({ data }: { data: Customer360 }) {
  const fullName = (data.profile.full_name as string | undefined) ?? "(chưa có tên)";
  const initials = fullName.trim().slice(0, 1).toUpperCase();
  const totalSpend = data.transactions.reduce((s, t) => s + Number(t.total ?? 0), 0);
  return (
    <Panel bodyClassName="p-0">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl brand-gradient text-lg font-bold text-white">{initials}</span>
          <div>
            <div className="flex items-center gap-2.5">
              <p className="text-base font-semibold text-text">{fullName}</p>
              <TierBadge spend={totalSpend} size="lg" />
            </div>
            <p className="font-mono text-xs text-text-muted">{data.occId}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs text-text-subtle">Giao dịch</div>
            <div data-testid="txn-count" className="tabular text-xl font-bold text-text">{data.transactions.length}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-subtle">Số định danh</div>
            <div className="tabular text-xl font-bold text-text">{data.identifiers.length}</div>
          </div>
        </div>
      </div>
      <div className="border-t border-border px-5 py-3.5">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-subtle">Định danh hợp nhất</div>
        <div className="flex flex-wrap gap-2">
          {data.identifiers.map((id) => (
            <Badge key={`${id.identifier_type}:${id.value_normalized}`} tone="neutral">
              <span className="text-text-subtle">{id.identifier_type}</span>
              <span className="font-mono">{id.value_normalized}</span>
            </Badge>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function Gauge({ label, value, tone }: { label: string; value: number | null; tone: "up" | "down" }) {
  const pct = value === null ? 0 : Math.round(value * 100);
  const color = tone === "down" ? "bg-error" : "bg-accent";
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-muted">{label}</span>
        <span className="tabular font-semibold text-text">{value === null ? "—" : `${pct}%`}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-alt">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AiBehaviorPanel({
  feature, nba, explain, explainBusy, onExplain,
}: {
  feature: CustomerFeature;
  nba: NbaDecision | null;
  explain: string | null;
  explainBusy: boolean;
  onExplain: () => void;
}) {
  return (
    <Panel
      testid="ai-behavior"
      icon={<Sparkles className="size-4" />}
      title="Phân tích hành vi (AI)"
      subtitle="Điểm số RFM · vòng đời · xu hướng"
      actions={
        <Button size="sm" variant="secondary" onClick={onExplain} loading={explainBusy}>
          {explainBusy ? "Đang diễn giải…" : "Diễn giải (AI)"}
        </Button>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-text-muted">Vòng đời:</span>
        <span data-testid="ai-lifecycle">
          <Badge tone="accent">
            {feature.lifecycleStage ? (LIFECYCLE_LABEL[feature.lifecycleStage] ?? feature.lifecycleStage) : "—"}
          </Badge>
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Gauge label="Churn risk" value={feature.churnRisk} tone="down" />
        <Gauge label="Xu hướng mua" value={feature.propensityScore} tone="up" />
        <MiniStat label="Chi tiêu (M)" value={fmtVndFull(feature.monetary)} />
        <MiniStat label="Giao dịch (F)" value={fmtInt(feature.frequency)} />
        <MiniStat label="Recency (ngày)" value={feature.recencyDays === null ? "—" : fmtInt(feature.recencyDays)} />
        <MiniStat label="Số thương hiệu" value={fmtInt(feature.distinctBrands)} />
        <MiniStat label="Giỏ TB" value={fmtVndFull(feature.avgBasket)} />
        <MiniStat label="Nhóm hàng ưa thích" value={feature.favoriteCategory ?? "—"} />
      </div>

      {nba && (
        <div className="mt-4 rounded-lg border border-accent-subtle bg-accent-subtle/40 p-4" data-testid="ai-nba">
          <div className="mb-1 flex items-center gap-2">
            <Target className="size-4 text-accent" />
            <span className="text-xs font-semibold uppercase tracking-wide text-accent">Next-Best-Action</span>
            <StatusPill tone={nba.eligible ? "success" : "warning"}>{nba.eligible ? "Đủ điều kiện" : "Chưa đủ"}</StatusPill>
          </div>
          <p className="text-sm font-medium text-text">
            {nba.action.type}
            {nba.action.points ? ` · ${nba.action.points} điểm` : ""}
            {nba.action.channel ? ` · ${nba.action.channel}` : ""}
          </p>
          <ul className="mt-1.5 list-disc pl-5 text-xs text-text-muted">
            {nba.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      {explain && (
        <div className="mt-4 rounded-lg border border-border bg-surface-alt p-4" data-testid="ai-explain">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">Diễn giải (LLM)</div>
          <p className="whitespace-pre-wrap text-sm text-text">{explain}</p>
        </div>
      )}
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-xs text-text-subtle">{label}</div>
      <div className="tabular mt-0.5 text-sm font-semibold text-text">{value}</div>
    </div>
  );
}

function CrossSell({ recs }: { recs: Recommendation[] }) {
  const columns: Column<Recommendation>[] = [
    { key: "sku", header: "SKU", cell: (r) => <span className="font-mono text-xs text-text-muted">{r.sku}</span>, width: "120px" },
    { key: "name", header: "Sản phẩm", cell: (r) => r.name ?? "(không tên)" },
    { key: "score", header: "Điểm", numeric: true, cell: (r) => <span className="font-semibold text-accent">{r.score}</span>, width: "100px" },
  ];
  return (
    <Panel icon={<ShoppingBag className="size-4" />} title="Gợi ý cross-sell (AI)" subtitle="Khách tương tự cũng mua" bodyClassName="p-0">
      <Table
        columns={columns}
        rows={recs}
        rowKey={(r) => r.sku}
        density="compact"
        className="rounded-none border-0 shadow-none"
      />
    </Panel>
  );
}
