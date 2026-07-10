import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Scale, Plus, Trash2, Search, FlaskConical, Trophy, Sparkles } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type Offer, type ArbitrationResult, type Experiment, type Uplift } from "../lib/types.js";
import { fmtInt, fmtVndFull } from "../lib/format.js";
import {
  PageHeader, Panel, Tabs, Table, Drawer, Field, Input, Select, Button, Badge, StatTile, StatusPill,
  Donut, BarChart, EmptyState, Skeleton, useToast, type Column,
} from "../ui/index.js";

const KIND_LABEL: Record<string, string> = { loyalty_bonus: "Thưởng điểm", discount: "Giảm giá", content: "Nội dung", activation: "Kích hoạt kênh" };

/** AI Decisioning — offer arbitration + Experimentation (A/B holdout + uplift). */
export function DecisioningScreen() {
  const [tab, setTab] = useState("offers");
  return (
    <div className="mx-auto max-w-[1180px] p-6">
      <PageHeader
        title="Quyết định (AI Decisioning)"
        description="Chọn hành động tốt nhất cho từng khách bằng arbitration (giá trị kỳ vọng = khả năng mua × giá trị ưu đãi) + thử nghiệm A/B đo uplift."
        breadcrumb={["AI", "Quyết định"]}
        badge={<Badge tone="violet" icon={<Sparkles className="size-3" />}>ML propensity + luật</Badge>}
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} items={[
        { value: "offers", label: "Danh mục ưu đãi" },
        { value: "arbitrate", label: "Arbitration" },
        { value: "experiments", label: "Thử nghiệm & Uplift" },
      ]} />
      {tab === "offers" && <OffersTab />}
      {tab === "arbitrate" && <ArbitrateTab />}
      {tab === "experiments" && <ExperimentsTab />}
    </div>
  );
}

function OffersTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", kind: "loyalty_bonus", baseValue: "", purpose: "", channel: "", eligibility: "" });
  const q = useQuery({ queryKey: ["offers"], queryFn: api.listOffers });

  const create = useMutation({
    mutationFn: () => api.createOffer({
      name: form.name.trim(), kind: form.kind, baseValue: Number(form.baseValue) || 0,
      ...(form.purpose.trim() ? { purpose: form.purpose.trim() } : {}),
      ...(form.channel.trim() ? { channel: form.channel.trim() } : {}),
      ...(form.eligibility.trim() ? { eligibility: form.eligibility.trim() } : {}),
    }),
    onSuccess: () => { setOpen(false); setForm({ name: "", kind: "loyalty_bonus", baseValue: "", purpose: "", channel: "", eligibility: "" }); void qc.invalidateQueries({ queryKey: ["offers"] }); },
    onError: (e) => toast.push(e instanceof ApiError ? e.message : "Lỗi tạo offer", "error"),
  });
  const del = useMutation({ mutationFn: (id: string) => api.deleteOffer(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ["offers"] }) });

  const cols: Column<Offer>[] = [
    { key: "name", header: "Ưu đãi", cell: (o) => <span className="font-medium text-text">{o.name}</span> },
    { key: "kind", header: "Loại", width: "130px", cell: (o) => <Badge tone="neutral">{KIND_LABEL[o.kind] ?? o.kind}</Badge> },
    { key: "value", header: "Giá trị", numeric: true, width: "130px", cell: (o) => <span className="font-semibold tabular">{fmtVndFull(o.baseValue)}</span> },
    { key: "elig", header: "Áp dụng", width: "110px", cell: (o) => o.eligibility ? <Badge tone="accent">{o.eligibility}</Badge> : <span className="text-text-subtle">mọi khách</span> },
    { key: "consent", header: "Consent", width: "120px", cell: (o) => o.purpose ? <span className="text-xs text-warning">{o.purpose}</span> : <span className="text-xs text-text-subtle">không cần</span> },
    { key: "act", header: "", numeric: true, width: "60px", cell: (o) => <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => del.mutate(o.id)} /> },
  ];

  return (
    <Panel title="Danh mục ưu đãi" icon={<Scale className="size-4" />} subtitle="Ưu đãi để arbitration lựa chọn"
      actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setOpen(true)}>Thêm ưu đãi</Button>} bodyClassName="p-0">
      <Table columns={cols} rows={q.data ?? []} rowKey={(o) => o.id} loading={q.isLoading} empty={{ title: "Chưa có ưu đãi" }} density="compact" />
      <Drawer open={open} onClose={() => setOpen(false)} title="Thêm ưu đãi"
        footer={<Button variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!form.name.trim()}>Lưu</Button>}>
        <div className="space-y-3">
          <Field label="Tên ưu đãi"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Loại"><Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select></Field>
          <Field label="Giá trị kỳ vọng (VND)"><Input inputMode="numeric" value={form.baseValue} onChange={(e) => setForm({ ...form, baseValue: e.target.value })} /></Field>
          <Field label="Áp dụng cho vòng đời (tuỳ chọn)"><Input value={form.eligibility} onChange={(e) => setForm({ ...form, eligibility: e.target.value })} placeholder="vd at_risk / vip / active" /></Field>
          <Field label="Consent purpose (nếu là kênh marketing)"><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="vd marketing_email" /></Field>
          <Field label="Kênh (tuỳ chọn)"><Input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="vd email / zalo" /></Field>
        </div>
      </Drawer>
    </Panel>
  );
}

function ArbitrateTab() {
  const [occId, setOccId] = useState("");
  const [result, setResult] = useState<ArbitrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function run() {
    if (!occId.trim()) return;
    setBusy(true);
    try { setResult(await api.arbitrate(occId.trim())); }
    catch (e) { toast.push(e instanceof ApiError ? e.message : "Lỗi", "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Panel title="Arbitration cho một khách" icon={<Scale className="size-4" />}>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-[320px] flex-1" label="OCH ID">
            <Input value={occId} onChange={(e) => setOccId(e.target.value)} placeholder="uuid khách hàng" className="font-mono" icon={<Search className="size-4" />} />
          </Field>
          <Button variant="primary" onClick={run} loading={busy} disabled={!occId.trim()} className="mb-[1px]">Chọn hành động tốt nhất</Button>
        </div>
      </Panel>

      {result && (
        <>
          {result.winner ? (
            <Panel title="Hành động được chọn" icon={<Trophy className="size-4" />}>
              <div className="flex flex-wrap items-center gap-4">
                <div><div className="text-lg font-bold text-accent">{result.winner.name}</div><div className="text-xs text-text-muted">{result.winner.reason} · vòng đời: {result.lifecycleStage ?? "?"}</div></div>
                <StatTile label="Giá trị kỳ vọng" value={fmtVndFull(result.winner.expectedValue)} icon={<Trophy className="size-4" />} />
              </div>
            </Panel>
          ) : (
            <EmptyState title="Không có ưu đãi phù hợp" description="Không offer nào đủ điều kiện cho khách này (consent / vòng đời)." />
          )}
          <Panel title="Các ứng viên (expected value)" subtitle="EV = khả năng mua × giá trị ưu đãi (đủ điều kiện mới tính)" bodyClassName="p-0">
            {result.candidates.length > 0 && (
              <div className="p-4">
                <BarChart height={Math.max(140, result.candidates.length * 34)} data={result.candidates.map((c) => ({ label: c.name, value: c.expectedValue }))} valueFormatter={fmtVndFull} />
              </div>
            )}
            <CandidateTable candidates={result.candidates} />
          </Panel>
        </>
      )}
    </div>
  );
}

function CandidateTable({ candidates }: { candidates: ArbitrationResult["candidates"] }) {
  const cols: Column<ArbitrationResult["candidates"][number]>[] = [
    { key: "name", header: "Ưu đãi", cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: "prop", header: "Khả năng mua", numeric: true, width: "120px", cell: (c) => <span className="tabular">{Math.round(c.propensity * 100)}%</span> },
    { key: "ev", header: "Giá trị kỳ vọng", numeric: true, width: "140px", cell: (c) => <span className="font-semibold">{fmtVndFull(c.expectedValue)}</span> },
    { key: "elig", header: "Đủ ĐK", width: "100px", cell: (c) => c.eligible ? <StatusPill tone="success">có</StatusPill> : <StatusPill tone="neutral">{c.reason}</StatusPill> },
  ];
  return <Table columns={cols} rows={candidates} rowKey={(c) => c.offerId} density="compact" className="rounded-none border-0 shadow-none" />;
}

function ExperimentsTab() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Experiment | null>(null);
  const q = useQuery({ queryKey: ["experiments"], queryFn: api.listExperiments });

  const create = useMutation({
    mutationFn: () => api.createExperiment(name.trim(), 20),
    onSuccess: async (e) => { setName(""); await api.assignExperiment(e.id); void qc.invalidateQueries({ queryKey: ["experiments"] }); },
    onError: (er) => toast.push(er instanceof ApiError ? er.message : "Lỗi", "error"),
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <Panel title="Thử nghiệm A/B" icon={<FlaskConical className="size-4" />} bodyClassName="p-0">
        <div className="flex items-end gap-2 border-b border-border p-3">
          <Field className="flex-1" label="Tên thử nghiệm"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd Win-back email" /></Field>
          <Button size="sm" variant="primary" onClick={() => create.mutate()} loading={create.isPending} disabled={!name.trim()} className="mb-[1px]">Tạo</Button>
        </div>
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((e) => (
            <li key={e.id}>
              <button type="button" onClick={() => setSel(e)} className={`flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-accent-subtle/40 ${sel?.id === e.id ? "bg-accent-subtle/40" : ""}`}>
                <span className="font-medium text-text">{e.name}</span>
                <Badge tone="neutral">holdout {e.holdoutPct}%</Badge>
              </button>
            </li>
          ))}
          {(q.data?.length ?? 0) === 0 && <li className="p-4 text-sm text-text-muted">Chưa có thử nghiệm.</li>}
        </ul>
      </Panel>
      <div>{sel ? <UpliftView experiment={sel} /> : <EmptyState title="Chọn một thử nghiệm" description="Xem phân bổ biến thể + uplift." />}</div>
    </div>
  );
}

function UpliftView({ experiment }: { experiment: Experiment }) {
  const uq = useQuery({ queryKey: ["uplift", experiment.id], queryFn: () => api.getUplift(experiment.id) });
  if (uq.isLoading) return <Skeleton className="h-64 w-full" />;
  const u = uq.data as Uplift | undefined;
  if (!u) return <EmptyState title="Chưa có dữ liệu uplift" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Treatment" value={`${Math.round(u.treatment.rate * 100)}%`} icon={<FlaskConical className="size-4" />} hint={`${u.treatment.converted}/${u.treatment.n} chuyển đổi`} />
        <StatTile label="Holdout" value={`${Math.round(u.holdout.rate * 100)}%`} icon={<FlaskConical className="size-4" />} hint={`${u.holdout.converted}/${u.holdout.n} chuyển đổi`} />
        <StatTile label="Uplift" value={`${u.upliftPct >= 0 ? "+" : ""}${u.upliftPct}%`} icon={<Trophy className="size-4" />} deltaTone={u.upliftPct >= 0 ? "up" : "down"} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Chuyển đổi treatment vs holdout" bodyClassName="p-3">
          <BarChart horizontal={false} height={200} data={[{ label: "Treatment", value: Math.round(u.treatment.rate * 1000) }, { label: "Holdout", value: Math.round(u.holdout.rate * 1000) }]} valueFormatter={(n) => `${(n / 10).toFixed(1)}%`} />
        </Panel>
        <Panel title="Phân bổ biến thể" bodyClassName="p-3">
          <Donut height={200} data={[{ name: "Treatment", value: u.treatment.n }, { name: "Holdout", value: u.holdout.n }]} valueFormatter={fmtInt} />
        </Panel>
      </div>
      <p className="text-xs text-text-subtle">Demo-grade: chuyển đổi = có giao dịch sau thời điểm gán biến thể; phân bổ deterministic theo hash(khách+thử nghiệm), không phải bandit online.</p>
    </div>
  );
}
