import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Cpu, ToggleRight, SlidersHorizontal, History, Gauge, ShieldAlert } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type AiConfig, type LlmProvider, type LlmUsageEntry } from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import {
  PageHeader, Panel, Field, Input, Select, Button, Checkbox, Badge, Table, type Column, EmptyState,
} from "../ui/index.js";

const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "gemini"];
const TASKS: (keyof AiConfig["llm"]["tasks"])[] = ["ask", "segment", "content", "explain"];

/** AI & Governance (admin) — cấu hình LLM provider/model, bật/tắt tính năng AI, tham số, audit, usage. */
export function AiGovernanceScreen() {
  const qc = useQueryClient();
  const cfgQ = useQuery({ queryKey: ["ai-config"], queryFn: api.getAiConfig });
  const auditQ = useQuery({ queryKey: ["ai-config-audit"], queryFn: api.listAiConfigAudit });
  const usageQ = useQuery({ queryKey: ["ai-usage"], queryFn: api.listLlmUsage });
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState<AiConfig | null>(null);
  useEffect(() => {
    if (cfgQ.data) setDraft(structuredClone(cfgQ.data));
  }, [cfgQ.data]);

  const saveMut = useMutation({
    mutationFn: (v: { section: keyof AiConfig; value: Record<string, unknown> }) => api.setAiConfig(v.section, v.value),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["ai-config"] });
      void qc.invalidateQueries({ queryKey: ["ai-config-audit"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi lưu cấu hình"),
  });

  const header = (
    <PageHeader
      title="AI & Governance"
      description="Cấu hình AI RBAC-gated (chỉ admin) — model LLM, bật/tắt tính năng, tham số, audit, usage."
      breadcrumb={["AI", "AI & Governance"]}
      badge={<Badge tone="violet" icon={<BrainCircuit className="size-3" />}>Admin</Badge>}
    />
  );

  if (cfgQ.isLoading || !draft) {
    return <div className="mx-auto max-w-[1100px] p-6">{header}<p className="text-sm text-text-muted">Đang tải…</p></div>;
  }
  if (cfgQ.isError) {
    return <div className="mx-auto max-w-[1100px] p-6">{header}<EmptyState tone="error" icon={<ShieldAlert className="size-6" />} title="Không tải được cấu hình AI" description="Chỉ admin được phép truy cập." /></div>;
  }

  const usageCols: Column<LlmUsageEntry>[] = [
    { key: "task", header: "Tác vụ", cell: (u) => <span className="font-mono text-xs">{u.task}</span> },
    { key: "model", header: "Provider / Model", cell: (u) => <span className="font-mono text-xs text-text-muted">{u.provider}/{u.model}</span> },
    { key: "in", header: "Input tokens", numeric: true, cell: (u) => fmtInt(u.input_tokens) },
    { key: "out", header: "Output tokens", numeric: true, cell: (u) => fmtInt(u.output_tokens) },
  ];

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 p-6">
      {header}
      {error && <div className="flex items-center gap-2 rounded-lg border border-error-subtle bg-error-subtle px-4 py-2.5 text-sm text-error"><ShieldAlert className="size-4" />{error}</div>}

      <Panel title="LLM Settings — nhà cung cấp & model" icon={<Cpu className="size-4" />}>
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field className="w-44" label="Provider mặc định">
            <Select aria-label="Provider mặc định" value={draft.llm.defaultProvider}
              onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, defaultProvider: e.target.value as LlmProvider } })}>
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field className="w-52" label="PII policy">
            <Select aria-label="PII policy" value={draft.llm.piiPolicy}
              onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, piiPolicy: e.target.value as AiConfig["llm"]["piiPolicy"] } })}>
              <option value="redact">redact (khuyến nghị)</option>
              <option value="block">block</option>
              <option value="allow">allow</option>
            </Select>
          </Field>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-alt">
              <tr className="text-left text-xs font-semibold text-text-muted">
                <th className="px-3.5 py-2.5">Tác vụ</th><th className="px-3.5 py-2.5">Provider</th><th className="px-3.5 py-2.5">Model</th>
              </tr>
            </thead>
            <tbody>
              {TASKS.map((t) => (
                <tr key={t} data-testid={`llm-task-${t}`} className="border-t border-border">
                  <td className="px-3.5 py-2 font-mono text-xs">{t}</td>
                  <td className="px-3.5 py-2">
                    <Select aria-label={`Provider ${t}`} className="h-8 w-36" value={draft.llm.tasks[t].provider}
                      onChange={(e) => {
                        const tasks = { ...draft.llm.tasks, [t]: { ...draft.llm.tasks[t], provider: e.target.value as LlmProvider } };
                        setDraft({ ...draft, llm: { ...draft.llm, tasks } });
                      }}>
                      {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </td>
                  <td className="px-3.5 py-2">
                    <Input aria-label={`Model ${t}`} className="h-8 w-64 font-mono text-xs" value={draft.llm.tasks[t].model}
                      onChange={(e) => {
                        const tasks = { ...draft.llm.tasks, [t]: { ...draft.llm.tasks[t], model: e.target.value } };
                        setDraft({ ...draft, llm: { ...draft.llm, tasks } });
                      }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={() => saveMut.mutate({ section: "llm", value: draft.llm as unknown as Record<string, unknown> })} loading={saveMut.isPending}>Lưu LLM settings</Button>
        </div>
        <p className="mt-2 text-xs text-text-subtle">API key cấu hình qua ENV (ANTHROPIC_API_KEY…), không lưu trong DB. Provider cloud: cấm gửi PII (guardrail).</p>
      </Panel>

      <Panel title="Tính năng AI (bật/tắt)" icon={<ToggleRight className="size-4" />}>
        <div className="flex flex-wrap gap-5">
          {(["recoV2", "nba", "forecast", "assistant"] as const).map((f) => (
            <Checkbox key={f} label={<span className="font-mono text-xs">{f}</span>} checked={draft.features[f]}
              onChange={(v) => setDraft({ ...draft, features: { ...draft.features, [f]: v } })} />
          ))}
        </div>
        <div className="mt-3">
          <Button variant="primary" onClick={() => saveMut.mutate({ section: "features", value: draft.features as unknown as Record<string, unknown> })} loading={saveMut.isPending}>Lưu tính năng</Button>
        </div>
      </Panel>

      <Panel title="Tham số recommendation & RFM" icon={<SlidersHorizontal className="size-4" />}>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
          <NumField label="reco.topN" value={draft.reco.topN} onChange={(v) => setDraft({ ...draft, reco: { ...draft.reco, topN: v } })} />
          <NumField label="reco.diversity (×100)" value={Math.round(draft.reco.diversityWeight * 100)} onChange={(v) => setDraft({ ...draft, reco: { ...draft.reco, diversityWeight: v / 100 } })} />
          <NumField label="rfm.vipFreq" value={draft.rfm.vipFreq} onChange={(v) => setDraft({ ...draft, rfm: { ...draft.rfm, vipFreq: v } })} />
          <NumField label="rfm.churnGapDays" value={draft.rfm.churnGapDays} onChange={(v) => setDraft({ ...draft, rfm: { ...draft.rfm, churnGapDays: v } })} />
        </div>
        <div className="mt-3 flex flex-wrap gap-5">
          <Checkbox label={<span className="font-mono text-xs">enableCrossBrand</span>} checked={draft.reco.enableCrossBrand} onChange={(v) => setDraft({ ...draft, reco: { ...draft.reco, enableCrossBrand: v } })} />
          <Checkbox label={<span className="font-mono text-xs">enableMarketBasket</span>} checked={draft.reco.enableMarketBasket} onChange={(v) => setDraft({ ...draft, reco: { ...draft.reco, enableMarketBasket: v } })} />
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={() => saveMut.mutate({ section: "reco", value: draft.reco as unknown as Record<string, unknown> })} loading={saveMut.isPending}>Lưu reco</Button>
          <Button variant="secondary" onClick={() => saveMut.mutate({ section: "rfm", value: draft.rfm as unknown as Record<string, unknown> })} loading={saveMut.isPending}>Lưu RFM</Button>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Audit thay đổi cấu hình (bất biến)" icon={<History className="size-4" />} bodyClassName="p-0">
          {(auditQ.data?.length ?? 0) === 0 && <p className="p-4 text-sm text-text-muted">Chưa có thay đổi.</p>}
          <ul className="divide-y divide-border">
            {(auditQ.data ?? []).slice(0, 20).map((a) => (
              <li key={a.id} data-testid={`audit-${a.id}`} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-mono text-xs text-text">{a.key}</span>
                <span className="text-xs text-text-subtle">{a.changed_by} · {new Date(a.changed_at).toLocaleString("vi-VN")}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="LLM Usage (token / cost)" icon={<Gauge className="size-4" />} bodyClassName="p-0">
          <Table columns={usageCols} rows={(usageQ.data ?? []).slice(0, 20)} rowKey={(u) => u.id}
            loading={usageQ.isLoading} empty={{ title: "Chưa có lượt gọi LLM" }} density="compact"
            className="rounded-none border-0 shadow-none" />
        </Panel>
      </div>
    </div>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <Field label={<span className="font-mono text-xs">{label}</span>}>
      <Input type="number" aria-label={label} className="tabular" value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </Field>
  );
}
