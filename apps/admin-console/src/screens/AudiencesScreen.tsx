import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Send, Users, ShieldX, SlidersHorizontal } from "lucide-react";
import { api } from "../lib/api.js";
import {
  type ActivateResult,
  type ConsentPurpose,
  type SegmentCriteria,
} from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import { PageHeader, Panel, Field, Select, Input, Textarea, Button, Badge, StatTile, EmptyState } from "../ui/index.js";

const PURPOSES: { value: ConsentPurpose; label: string }[] = [
  { value: "marketing_email", label: "Email marketing" },
  { value: "marketing_sms", label: "SMS marketing" },
  { value: "marketing_zalo", label: "Zalo marketing" },
  { value: "personalization", label: "Cá nhân hóa" },
  { value: "data_sharing", label: "Chia sẻ dữ liệu" },
];

/** Audiences — kích hoạt danh sách AICDP ID tới destination, GATE bằng consent (deny-by-default). */
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
            <Field className="mt-3" label={`Danh sách AICDP ID (mỗi dòng hoặc cách nhau dấu phẩy) — ${occIds.length} id`}>
              <Textarea aria-label="Danh sách AICDP ID" value={raw} onChange={(e) => setRaw(e.target.value)} rows={5} className="font-mono text-xs" />
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
      </div>
    </div>
  );
}
