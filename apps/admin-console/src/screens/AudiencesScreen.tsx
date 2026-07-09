import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Users, ShieldX, SlidersHorizontal, History, CheckCircle2 } from "lucide-react";
import { api } from "../lib/api.js";
import {
  type ActivateResult,
  type ActivationRun,
  type ActivationMember,
  type ConsentPurpose,
  type SegmentCriteria,
} from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import { PageHeader, Panel, Field, Select, Input, Textarea, Button, Badge, StatTile, EmptyState, Table, Drawer, Skeleton, type Column } from "../ui/index.js";

const PURPOSE_LABEL: Record<string, string> = {
  marketing_email: "Email", marketing_sms: "SMS", marketing_zalo: "Zalo",
  personalization: "Cá nhân hóa", data_sharing: "Chia sẻ dữ liệu",
};
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const PURPOSES: { value: ConsentPurpose; label: string }[] = [
  { value: "marketing_email", label: "Email marketing" },
  { value: "marketing_sms", label: "SMS marketing" },
  { value: "marketing_zalo", label: "Zalo marketing" },
  { value: "personalization", label: "Cá nhân hóa" },
  { value: "data_sharing", label: "Chia sẻ dữ liệu" },
];

/** Audiences — kích hoạt danh sách OCH ID tới destination, GATE bằng consent (deny-by-default). */
export function AudiencesScreen() {
  const [audienceName, setAudienceName] = useState("");
  const [purpose, setPurpose] = useState<ConsentPurpose>("marketing_email");
  const [channel, setChannel] = useState("email");
  const [destination, setDestination] = useState("rudderstack");
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<ActivateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [segBrand, setSegBrand] = useState("");
  const [segMinSpend, setSegMinSpend] = useState("");
  const [segMinTxn, setSegMinTxn] = useState("");
  const [segCount, setSegCount] = useState<number | null>(null);
  const brands = useQuery({ queryKey: ["brands"], queryFn: api.listBrands });
  const runs = useQuery({ queryKey: ["activation-runs"], queryFn: api.listActivationRuns });

  async function previewSegment() {
    setBusy(true);
    setError(null);
    try {
      const criteria: SegmentCriteria = {
        ...(segBrand ? { brandId: segBrand } : {}),
        ...(segMinSpend.trim() ? { minSpend: Number(segMinSpend) } : {}),
        ...(segMinTxn.trim() ? { minTransactions: Number(segMinTxn) } : {}),
      };
      const seg = await api.previewSegment(criteria);
      setRaw(seg.occIds.join("\n"));
      setSegCount(seg.count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi segment");
    } finally {
      setBusy(false);
    }
  }

  const occIds = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

  async function run() {
    if (!audienceName.trim() || occIds.length === 0) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.activate({ audienceName: audienceName.trim(), purpose, channel: channel.trim(), destination: destination.trim(), occIds }));
      void runs.refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lỗi kích hoạt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[960px] p-6">
      <PageHeader
        title="Audiences · Activation"
        description="Kích hoạt audience tới destination. Người chưa cấp consent cho mục đích này sẽ bị loại (deny-by-default) — chokepoint consent duy nhất."
        breadcrumb={["Phân tích", "Audiences"]}
      />

      <div className="space-y-5">
        <Panel title="Dựng segment theo tiêu chí" icon={<SlidersHorizontal className="size-4" />}>
          <div className="flex flex-wrap items-end gap-3">
            <Field className="w-44" label="Thương hiệu">
              <Select aria-label="Thương hiệu segment" value={segBrand} onChange={(e) => setSegBrand(e.target.value)}>
                <option value="">— tất cả —</option>
                {brands.data?.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field className="w-44" label="Chi tiêu tối thiểu (VND)">
              <Input aria-label="Chi tiêu tối thiểu" inputMode="numeric" value={segMinSpend} onChange={(e) => setSegMinSpend(e.target.value)} className="tabular" />
            </Field>
            <Field className="w-40" label="Số giao dịch tối thiểu">
              <Input aria-label="Số giao dịch tối thiểu" inputMode="numeric" value={segMinTxn} onChange={(e) => setSegMinTxn(e.target.value)} className="tabular" />
            </Field>
            <Button variant="secondary" onClick={previewSegment} loading={busy} className="mb-[1px]">Xem trước segment</Button>
            {segCount !== null && (
              <span className="mb-2 text-sm text-text-muted">
                khớp <strong data-testid="segment-count" className="text-accent">{fmtInt(segCount)}</strong> khách
              </span>
            )}
          </div>
        </Panel>

        <form onSubmit={(e) => { e.preventDefault(); run(); }}>
          <Panel title="Kích hoạt audience" icon={<Send className="size-4" />}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Tên audience"><Input aria-label="Tên audience" value={audienceName} onChange={(e) => setAudienceName(e.target.value)} /></Field>
              <Field label="Mục đích (consent)">
                <Select aria-label="Mục đích consent" value={purpose} onChange={(e) => setPurpose(e.target.value as ConsentPurpose)}>
                  {PURPOSES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Kênh"><Input aria-label="Kênh" value={channel} onChange={(e) => setChannel(e.target.value)} /></Field>
              <Field label="Destination"><Input aria-label="Destination" value={destination} onChange={(e) => setDestination(e.target.value)} /></Field>
            </div>
            <Field className="mt-3" label={`Danh sách OCH ID (mỗi dòng hoặc cách nhau dấu phẩy) — ${occIds.length} id`}>
              <Textarea aria-label="Danh sách OCH ID" value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} className="font-mono text-xs" />
            </Field>
            <div className="mt-3">
              <Button type="submit" variant="primary" disabled={busy || !audienceName.trim() || occIds.length === 0} loading={busy} icon={<Send className="size-4" />}>
                {busy ? "Đang kích hoạt…" : "Kích hoạt"}
              </Button>
            </div>
          </Panel>
        </form>

        {error && <EmptyState tone="error" icon={<ShieldX className="size-6" />} title="Lỗi" description={error} />}

        {result && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs text-text-subtle">
              <Badge tone="neutral">run {result.runId.slice(0, 8)}…</Badge>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <StatTile testid="act-total" label="Tổng" value={fmtInt(result.total)} icon={<Users className="size-4" />} />
              <StatTile testid="act-allowed" label="Được gửi" value={fmtInt(result.allowedCount)} icon={<Send className="size-4" />} deltaTone="up" />
              <StatTile testid="act-suppressed" label="Bị chặn (no consent)" value={fmtInt(result.suppressedCount)} icon={<ShieldX className="size-4" />} deltaTone="down" />
            </div>
          </div>
        )}

        <ActivationHistory runs={runs.data ?? []} loading={runs.isLoading} />
      </div>
    </div>
  );
}

/** Lịch sử kích hoạt audience gần đây — bấm để xem danh sách khách của lần kích hoạt. */
function ActivationHistory({ runs, loading }: { runs: ActivationRun[]; loading: boolean }) {
  const [drill, setDrill] = useState<ActivationRun | null>(null);
  const columns: Column<ActivationRun>[] = [
    { key: "name", header: "Audience", cell: (r) => <span className="font-medium">{r.audience_name}</span> },
    { key: "purpose", header: "Mục đích", cell: (r) => <Badge tone="neutral">{PURPOSE_LABEL[r.purpose] ?? r.purpose}</Badge>, width: "120px" },
    { key: "channel", header: "Kênh", cell: (r) => <span className="text-text-muted">{r.channel}</span>, width: "90px" },
    { key: "total", header: "Tổng", numeric: true, cell: (r) => fmtInt(r.total), width: "80px" },
    { key: "allowed", header: "Đã gửi", numeric: true, cell: (r) => <span className="font-semibold text-success">{fmtInt(r.allowed_count)}</span>, width: "90px" },
    { key: "suppressed", header: "Bị chặn", numeric: true, cell: (r) => <span className="text-warning">{fmtInt(r.suppressed_count)}</span>, width: "90px" },
    { key: "date", header: "Thời gian", cell: (r) => <span className="tabular text-xs text-text-subtle">{fmtDateTime(r.created_at)}</span>, width: "110px" },
  ];
  return (
    <>
      <Panel title="Lịch sử kích hoạt" icon={<History className="size-4" />} subtitle={`${fmtInt(runs.length)} lần gần đây — bấm để xem khách của lần kích hoạt`} bodyClassName="p-0">
        <Table columns={columns} rows={runs} rowKey={(r) => r.run_id} loading={loading}
          onRowClick={setDrill} empty={{ title: "Chưa có lần kích hoạt nào" }} density="compact" />
      </Panel>
      {drill && <RunMembersDrawer run={drill} onClose={() => setDrill(null)} />}
    </>
  );
}

/** Drill-down: danh sách khách trong một lần kích hoạt (allowed / bị chặn). */
function RunMembersDrawer({ run, onClose }: { run: ActivationRun; onClose: () => void }) {
  const membersQ = useQuery({ queryKey: ["activation-members", run.run_id], queryFn: () => api.getActivationMembers(run.run_id) });
  const columns: Column<ActivationMember>[] = [
    {
      key: "name", header: "Khách hàng",
      cell: (m) => (
        <div>
          <div className="font-medium text-text">{m.fullName ?? "(chưa có tên)"}</div>
          <div className="font-mono text-[11px] text-text-subtle">{m.occId}</div>
        </div>
      ),
    },
    {
      key: "decision", header: "Kết quả", width: "150px",
      cell: (m) => m.decision === "allowed"
        ? <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>Đã gửi</Badge>
        : <Badge tone="warning" icon={<ShieldX className="size-3" />}>Chưa cấp consent</Badge>,
    },
  ];
  return (
    <Drawer open onClose={onClose} title={`Kết quả — ${run.audience_name}`}
      description={`${PURPOSE_LABEL[run.purpose] ?? run.purpose} · ${run.channel} → ${run.destination}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <StatTile label="Tổng" value={fmtInt(run.total)} icon={<Users className="size-4" />} />
          <StatTile label="Đã gửi" value={fmtInt(run.allowed_count)} icon={<Send className="size-4" />} />
          <StatTile label="Bị chặn" value={fmtInt(run.suppressed_count)} icon={<ShieldX className="size-4" />} deltaTone="down" />
        </div>
        <Panel title="Danh sách khách" icon={<Users className="size-4" />} bodyClassName="p-0">
          {membersQ.isLoading ? (
            <div className="p-4"><Skeleton className="h-40 w-full" /></div>
          ) : (
            <Table columns={columns} rows={membersQ.data ?? []} rowKey={(m) => m.occId}
              empty={{ title: "Không có khách trong lần kích hoạt này" }} density="compact" />
          )}
        </Panel>
      </div>
    </Drawer>
  );
}
