import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Gauge, Users, Cpu, RefreshCw, TrendingDown, Coins, ShoppingBag, CalendarClock, Sparkles } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type CustomerPrediction, type ModelCard } from "../lib/types.js";
import { fmtInt, fmtVndFull, fmtDateTime } from "../lib/format.js";
import {
  PageHeader, Panel, StatTile, StatusPill, Badge, Button, Table, Drawer, Skeleton,
  EmptyState, SegmentedControl, BarChart, useToast, type Column,
} from "../ui/index.js";

const MODELS = [
  { value: "churn", label: "Nguy cơ rời", metric: "churn" },
  { value: "clv", label: "Giá trị vòng đời", metric: "clv" },
  { value: "propensity", label: "Khả năng mua", metric: "propensity" },
  { value: "next_purchase", label: "Ngày mua kế", metric: "churn" },
] as const;

const MODEL_LABEL: Record<string, string> = {
  churn: "Nguy cơ rời (Churn)", clv: "CLV / LTV", propensity: "Khả năng mua", next_purchase: "Ngày mua kế tiếp",
};
const PAGE = 15;

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}
function churnTone(v: number | null): "success" | "warning" | "error" | "neutral" {
  if (v === null) return "neutral";
  return v >= 0.6 ? "error" : v >= 0.35 ? "warning" : "success";
}
function sourceBadge(src: "ml" | "heuristic", versions?: Record<string, string>) {
  return src === "ml"
    ? <Badge tone="accent">ML{versions?.churn ? ` · ${versions.churn}` : ""}</Badge>
    : <Badge tone="neutral">Heuristic</Badge>;
}

/** Predictive Studio — điểm dự đoán ML (ai-service) + fallback heuristic. */
export function PredictionsScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const [model, setModel] = useState<string>("churn");
  const [page, setPage] = useState(0);
  const [drill, setDrill] = useState<CustomerPrediction | null>(null);

  const metric = MODELS.find((m) => m.value === model)?.metric ?? "churn";
  const listQ = useQuery({
    queryKey: ["predictions", model, page],
    queryFn: () => api.listPredictions({ model, limit: PAGE, offset: page * PAGE }),
  });
  const cardsQ = useQuery({ queryKey: ["model-cards"], queryFn: api.getModelCards });
  const distQ = useQuery({ queryKey: ["pred-dist", metric], queryFn: () => api.getPredictionDistribution(metric) });
  const healthQ = useQuery({ queryKey: ["pred-health"], queryFn: api.getPredictionHealth });

  const rows = listQ.data?.data ?? [];
  const total = listQ.data?.meta.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE) - 1);
  const card = cardsQ.data?.find((c) => c.modelType === model);
  const source = rows[0]?.scoreSource ?? "heuristic";
  const churnHigh = (distQ.data ?? []).filter((b) => {
    const lo = Number(b.bucket.split("-")[0]);
    return metric === "churn" && lo >= 60;
  }).reduce((s, b) => s + b.count, 0);

  const recompute = useMutation({
    mutationFn: api.recomputePredictions,
    onSuccess: (r) => { toast.push(`Đã tính lại ${r.count} khách (nguồn ${r.source})`, "success"); void qc.invalidateQueries({ queryKey: ["predictions"] }); void qc.invalidateQueries({ queryKey: ["pred-dist"] }); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi tính lại", "error"),
  });

  const columns: Column<CustomerPrediction>[] = [
    {
      key: "name", header: "Khách hàng",
      cell: (c) => <div><div className="font-medium text-text">{c.fullName ?? "(chưa có tên)"}</div><div className="font-mono text-[11px] text-text-subtle">{c.occId}</div></div>,
    },
    { key: "clv", header: "CLV dự đoán", numeric: true, width: "130px", cell: (c) => <span className="font-semibold">{c.predictedClv === null ? "—" : fmtVndFull(c.predictedClv)}</span> },
    { key: "churn", header: "Nguy cơ rời", numeric: true, width: "110px", cell: (c) => <StatusPill tone={churnTone(c.churnProb)}>{pct(c.churnProb)}</StatusPill> },
    { key: "prop", header: "Khả năng mua", numeric: true, width: "110px", cell: (c) => <span className="tabular text-accent font-semibold">{pct(c.propensity)}</span> },
    { key: "next", header: "Ngày mua kế", width: "104px", cell: (c) => <span className="tabular text-xs text-text-subtle">{fmtDateTime(c.nextPurchaseAt)}</span> },
    { key: "src", header: "Nguồn", width: "120px", cell: (c) => sourceBadge(c.scoreSource, c.modelVersions) },
  ];

  return (
    <div className="mx-auto max-w-[1280px] p-6">
      <PageHeader
        title="Dự đoán (Predictive Studio)"
        description="Điểm dự đoán ML: nguy cơ rời, CLV, khả năng mua, ngày mua kế. Nguồn ai-service (ML) — tự chuyển heuristic khi ai-service ngoại tuyến."
        breadcrumb={["Phân tích", "Dự đoán"]}
        badge={<Badge tone={healthQ.data?.aiService ? "success" : "warning"} icon={<Cpu className="size-3" />}>{healthQ.data?.aiService ? "ai-service online" : "heuristic (ai-service offline)"}</Badge>}
        actions={<Button size="sm" variant="secondary" icon={<RefreshCw className={`size-3.5 ${recompute.isPending ? "animate-spin" : ""}`} />} onClick={() => recompute.mutate()} loading={recompute.isPending}>Tính lại điểm</Button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile label="Khách có điểm dự đoán" value={fmtInt(total)} icon={<Users className="size-4" />} />
        <StatTile label="Mô hình ML đã train" value={fmtInt(cardsQ.data?.filter((c) => !c.isDemo).length ?? 0)} icon={<Cpu className="size-4" />} hint={`${cardsQ.data?.length ?? 0} model card`} />
        <StatTile label="Nguồn điểm hiện tại" value={source === "ml" ? "ML" : "Heuristic"} icon={<Gauge className="size-4" />} />
        <StatTile label="Nguy cơ rời cao (≥60%)" value={fmtInt(churnHigh)} icon={<TrendingDown className="size-4" />} deltaTone="down" />
      </div>

      <div className="mb-4">
        <SegmentedControl items={MODELS.map((m) => ({ value: m.value, label: m.label }))} value={model} onChange={(v) => { setModel(v); setPage(0); }} />
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Panel title={`Phân phối — ${MODEL_LABEL[model]}`} subtitle="Số khách theo khoảng điểm" icon={<Gauge className="size-4" />}>
          {distQ.isLoading ? <Skeleton className="h-56 w-full" /> : (distQ.data ?? []).length > 0
            ? <BarChart horizontal={false} height={230} data={(distQ.data ?? []).map((b) => ({ label: b.bucket, value: b.count }))} valueFormatter={fmtInt} />
            : <EmptyState title="Chưa có phân phối" />}
        </Panel>
        <Panel title="Model card" subtitle="Chỉ số & độ quan trọng đặc trưng" icon={<Cpu className="size-4" />}>
          <ModelCardView card={card} loading={cardsQ.isLoading} />
        </Panel>
      </div>

      <Panel title="Khách hàng theo điểm dự đoán" subtitle={`${fmtInt(total)} khách — bấm để xem chi tiết & lý do`} bodyClassName="p-0">
        <Table columns={columns} rows={rows} rowKey={(c) => c.occId} loading={listQ.isLoading}
          onRowClick={setDrill} empty={{ title: "Chưa có dự đoán", description: "Bấm 'Tính lại điểm' để sinh dự đoán." }} density="compact" />
        {total > PAGE && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm">
            <span className="text-text-muted">Trang {page + 1}/{maxPage + 1}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Trước</Button>
              <Button size="sm" variant="secondary" disabled={page >= maxPage} onClick={() => setPage((p) => Math.min(maxPage, p + 1))}>Sau</Button>
            </div>
          </div>
        )}
      </Panel>

      {drill && <PredictionDrawer prediction={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function ModelCardView({ card, loading }: { card: ModelCard | undefined; loading: boolean }) {
  if (loading) return <Skeleton className="h-56 w-full" />;
  if (!card) return <EmptyState title="Chưa train model này" description="Model card xuất hiện sau khi ai-service train (POST /v1/train)." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label={card.metricName.toUpperCase()} value={card.metricValue.toFixed(card.metricName === "auc" ? 3 : 1)} icon={<Gauge className="size-4" />} />
        <StatTile label="Mẫu train" value={fmtInt(card.sampleSize ?? 0)} icon={<Users className="size-4" />} />
        <StatTile label="Phiên bản" value={card.modelVersion} icon={<Cpu className="size-4" />} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-subtle">
        <Badge tone="neutral">{card.algorithm}</Badge>
        {card.isDemo && <Badge tone="warning">demo-grade</Badge>}
        <span>train: {fmtDateTime(card.trainedAt)}</span>
      </div>
      {card.featureImportance.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-subtle">Độ quan trọng đặc trưng</div>
          <BarChart height={Math.max(140, card.featureImportance.length * 26)} data={card.featureImportance.slice(0, 8).map((f) => ({ label: f.feature, value: Math.abs(f.weight) }))} valueFormatter={(n) => n.toFixed(3)} />
        </div>
      )}
    </div>
  );
}

function PredictionDrawer({ prediction: p, onClose }: { prediction: CustomerPrediction; onClose: () => void }) {
  const [explain, setExplain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function doExplain() {
    setBusy(true);
    try {
      const r = await api.assistantExplain(p.occId);
      setExplain(r.text);
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : "Lỗi diễn giải", "error");
    } finally {
      setBusy(false);
    }
  }

  const churnReasons = p.explain?.churn ?? [];
  const propReasons = p.explain?.propensity ?? [];

  return (
    <Drawer open onClose={onClose} title={`Dự đoán — ${p.fullName ?? "(chưa có tên)"}`}
      description={p.occId}
      footer={<div className="flex items-center justify-between gap-2"><span>{sourceBadge(p.scoreSource, p.modelVersions)}</span><Button variant="primary" icon={<Sparkles className="size-4" />} onClick={doExplain} loading={busy}>Diễn giải bằng AI</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <StatTile label="CLV dự đoán" value={p.predictedClv === null ? "—" : fmtVndFull(p.predictedClv)} icon={<Coins className="size-4" />} {...(p.predictedPurchases ? { hint: `~${p.predictedPurchases} đơn tương lai` } : {})} />
          <StatTile label="Nguy cơ rời" value={pct(p.churnProb)} icon={<TrendingDown className="size-4" />} deltaTone="down" />
          <StatTile label="Khả năng mua" value={pct(p.propensity)} icon={<ShoppingBag className="size-4" />} deltaTone="up" />
          <StatTile label="Ngày mua kế" value={fmtDateTime(p.nextPurchaseAt)} icon={<CalendarClock className="size-4" />} {...(p.nextIntervalDays ? { hint: `sau ~${p.nextIntervalDays} ngày` } : {})} />
        </div>

        {(churnReasons.length > 0 || propReasons.length > 0) && (
          <Panel title="Vì sao (giải thích mô hình)" icon={<Gauge className="size-4" />}>
            {churnReasons.length > 0 && <ReasonList title="Nguy cơ rời" tone="error" reasons={churnReasons} />}
            {propReasons.length > 0 && <ReasonList title="Khả năng mua" tone="success" reasons={propReasons} />}
          </Panel>
        )}

        {explain && (
          <Panel title="Diễn giải bằng AI" icon={<Sparkles className="size-4" />}>
            <p className="whitespace-pre-line text-sm text-text-muted">{explain}</p>
          </Panel>
        )}
      </div>
    </Drawer>
  );
}

function ReasonList({ title, tone, reasons }: { title: string; tone: "error" | "success"; reasons: string[] }) {
  return (
    <div className="mb-2">
      <div className="mb-1 text-xs font-semibold text-text-subtle">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {reasons.map((r, i) => <Badge key={i} tone={tone === "error" ? "error" : "success"}>{r}</Badge>)}
      </div>
    </div>
  );
}
