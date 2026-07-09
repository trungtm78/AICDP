import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api.js";
import { ApiError, type AiConfig, type LlmProvider } from "../lib/types.js";

const PROVIDERS: LlmProvider[] = ["anthropic", "openai", "gemini"];
const TASKS: (keyof AiConfig["llm"]["tasks"])[] = ["ask", "segment", "content", "explain"];
const fmtNum = new Intl.NumberFormat("vi-VN");

/** AI & Governance (admin) — cấu hình LLM provider/model, bật/tắt tính năng AI, tham số, audit, usage. */
export function AiGovernanceScreen() {
  const qc = useQueryClient();
  const cfgQ = useQuery({ queryKey: ["ai-config"], queryFn: api.getAiConfig });
  const auditQ = useQuery({ queryKey: ["ai-config-audit"], queryFn: api.listAiConfigAudit });
  const usageQ = useQuery({ queryKey: ["ai-usage"], queryFn: api.listLlmUsage });
  const [error, setError] = useState<string | null>(null);

  // Bản nháp chỉnh sửa (đồng bộ khi load config).
  const [draft, setDraft] = useState<AiConfig | null>(null);
  useEffect(() => {
    if (cfgQ.data) setDraft(structuredClone(cfgQ.data));
  }, [cfgQ.data]);

  const saveMut = useMutation({
    mutationFn: (v: { section: keyof AiConfig; value: Record<string, unknown> }) =>
      api.setAiConfig(v.section, v.value),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ["ai-config"] });
      void qc.invalidateQueries({ queryKey: ["ai-config-audit"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Lỗi lưu cấu hình"),
  });

  if (cfgQ.isLoading || !draft) {
    return <Shell><p className="text-text-muted">Đang tải…</p></Shell>;
  }
  if (cfgQ.isError) {
    return <Shell><p className="text-error">Lỗi tải cấu hình AI (chỉ admin được phép).</p></Shell>;
  }

  return (
    <Shell>
      {error && <p className="mb-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-sm text-error">{error}</p>}

      {/* ── LLM Settings ── */}
      <Panel title="LLM Settings — nhà cung cấp & model">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">Provider mặc định</span>
            <select
              aria-label="Provider mặc định"
              className="rounded-md border border-border bg-surface px-2 py-1"
              value={draft.llm.defaultProvider}
              onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, defaultProvider: e.target.value as LlmProvider } })}
            >
              {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-text-muted">PII policy</span>
            <select
              aria-label="PII policy"
              className="rounded-md border border-border bg-surface px-2 py-1"
              value={draft.llm.piiPolicy}
              onChange={(e) => setDraft({ ...draft, llm: { ...draft.llm, piiPolicy: e.target.value as AiConfig["llm"]["piiPolicy"] } })}
            >
              <option value="redact">redact (khuyến nghị)</option>
              <option value="block">block</option>
              <option value="allow">allow</option>
            </select>
          </label>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-text-subtle"><th className="py-1">Tác vụ</th><th>Provider</th><th>Model</th></tr></thead>
          <tbody>
            {TASKS.map((t) => (
              <tr key={t} data-testid={`llm-task-${t}`} className="border-t border-border">
                <td className="py-1 font-mono text-xs">{t}</td>
                <td>
                  <select
                    aria-label={`Provider ${t}`}
                    className="rounded-md border border-border bg-surface px-2 py-1"
                    value={draft.llm.tasks[t].provider}
                    onChange={(e) => {
                      const tasks = { ...draft.llm.tasks, [t]: { ...draft.llm.tasks[t], provider: e.target.value as LlmProvider } };
                      setDraft({ ...draft, llm: { ...draft.llm, tasks } });
                    }}
                  >
                    {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Model ${t}`}
                    className="w-64 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs"
                    value={draft.llm.tasks[t].model}
                    onChange={(e) => {
                      const tasks = { ...draft.llm.tasks, [t]: { ...draft.llm.tasks[t], model: e.target.value } };
                      setDraft({ ...draft, llm: { ...draft.llm, tasks } });
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <SaveBtn label="Lưu LLM settings" onClick={() => saveMut.mutate({ section: "llm", value: draft.llm as unknown as Record<string, unknown> })} busy={saveMut.isPending} />
        <p className="mt-2 text-xs text-text-subtle">API key cấu hình qua ENV (ANTHROPIC_API_KEY…), không lưu trong DB. Provider cloud: cấm gửi PII (guardrail).</p>
      </Panel>

      {/* ── AI Features ── */}
      <Panel title="Tính năng AI (bật/tắt)">
        <div className="flex flex-wrap gap-4">
          {(["recoV2", "nba", "forecast", "assistant"] as const).map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`feature ${f}`}
                checked={draft.features[f]}
                onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [f]: e.target.checked } })}
              />
              <span className="font-mono text-xs">{f}</span>
            </label>
          ))}
        </div>
        <SaveBtn label="Lưu tính năng" onClick={() => saveMut.mutate({ section: "features", value: draft.features as unknown as Record<string, unknown> })} busy={saveMut.isPending} />
      </Panel>

      {/* ── Tham số reco + RFM ── */}
      <Panel title="Tham số recommendation & RFM">
        <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <NumField label="reco.topN" value={draft.reco.topN} onChange={(v) => setDraft({ ...draft, reco: { ...draft.reco, topN: v } })} />
          <NumField label="reco.diversity (×100)" value={Math.round(draft.reco.diversityWeight * 100)} onChange={(v) => setDraft({ ...draft, reco: { ...draft.reco, diversityWeight: v / 100 } })} />
          <NumField label="rfm.vipFreq" value={draft.rfm.vipFreq} onChange={(v) => setDraft({ ...draft, rfm: { ...draft.rfm, vipFreq: v } })} />
          <NumField label="rfm.churnGapDays" value={draft.rfm.churnGapDays} onChange={(v) => setDraft({ ...draft, rfm: { ...draft.rfm, churnGapDays: v } })} />
        </div>
        <div className="mt-2 flex gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="reco crossBrand" checked={draft.reco.enableCrossBrand} onChange={(e) => setDraft({ ...draft, reco: { ...draft.reco, enableCrossBrand: e.target.checked } })} /><span className="font-mono text-xs">enableCrossBrand</span></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="reco marketBasket" checked={draft.reco.enableMarketBasket} onChange={(e) => setDraft({ ...draft, reco: { ...draft.reco, enableMarketBasket: e.target.checked } })} /><span className="font-mono text-xs">enableMarketBasket</span></label>
        </div>
        <div className="flex gap-2">
          <SaveBtn label="Lưu reco" onClick={() => saveMut.mutate({ section: "reco", value: draft.reco as unknown as Record<string, unknown> })} busy={saveMut.isPending} />
          <SaveBtn label="Lưu RFM" onClick={() => saveMut.mutate({ section: "rfm", value: draft.rfm as unknown as Record<string, unknown> })} busy={saveMut.isPending} />
        </div>
      </Panel>

      {/* ── Audit ── */}
      <Panel title="Audit thay đổi cấu hình (bất biến)">
        {auditQ.data && auditQ.data.length === 0 && <p className="text-text-muted">Chưa có thay đổi.</p>}
        <ul className="space-y-1 text-sm">
          {(auditQ.data ?? []).slice(0, 20).map((a) => (
            <li key={a.id} data-testid={`audit-${a.id}`} className="border-t border-border py-1">
              <span className="font-mono text-xs">{a.key}</span> · {a.changed_by} · <span className="text-text-subtle">{new Date(a.changed_at).toLocaleString("vi-VN")}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* ── LLM Usage ── */}
      <Panel title="LLM Usage (token / cost)">
        {usageQ.data && usageQ.data.length === 0 && <p className="text-text-muted">Chưa có lượt gọi LLM.</p>}
        <table className="w-full text-sm">
          <tbody>
            {(usageQ.data ?? []).slice(0, 20).map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="py-1 font-mono text-xs">{u.task}</td>
                <td className="font-mono text-xs">{u.provider}/{u.model}</td>
                <td className="tabular-nums">in {fmtNum.format(u.input_tokens)} · out {fmtNum.format(u.output_tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-[1100px] p-6">
      <h1 className="text-xl font-bold tracking-tight">AI &amp; Governance</h1>
      <p className="mb-4 text-text-muted">Cấu hình AI RBAC-gated (chỉ admin) — model LLM, bật/tắt tính năng, tham số, audit, usage.</p>
      {children}
    </section>
  );
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-border bg-surface-alt p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </div>
  );
}
function NumField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block font-mono text-xs text-text-muted">{label}</span>
      <input
        type="number"
        aria-label={label}
        className="w-full rounded-md border border-border bg-surface px-2 py-1 tabular-nums"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function SaveBtn({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50">
      {busy ? "Đang lưu…" : label}
    </button>
  );
}
