import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Target, PenLine, Sparkles, ShieldAlert, Database, Bot, Wand2, CheckCircle2, SkipForward, XCircle } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type SegmentPreview, type NlqResult, type CopilotResult } from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import { PageHeader, Panel, SegmentedControl, Textarea, Button, EmptyState, Badge, Table, BarChart, AnomalyLine, StatusPill, useToast, type Column } from "../ui/index.js";

type Mode = "ask" | "query" | "segment" | "content" | "copilot";
const MODES: { value: Mode; label: string; icon: React.ReactNode; ph: string }[] = [
  { value: "ask", label: "Hỏi (tóm tắt)", icon: <MessageSquare className="size-3.5" />, ph: "vd: Hệ thống có bao nhiêu khách VIP?" },
  { value: "query", label: "Truy vấn dữ liệu", icon: <Database className="size-3.5" />, ph: "vd: doanh thu theo thương hiệu 90 ngày qua" },
  { value: "segment", label: "Tạo segment", icon: <Target className="size-3.5" />, ph: "vd: khách VIP chi tiêu trên 5 triệu, đã đồng ý email" },
  { value: "content", label: "Sinh nội dung", icon: <PenLine className="size-3.5" />, ph: "vd: viết tin nhắn khuyến mãi bánh trung thu cho khách thân thiết" },
  { value: "copilot", label: "Copilot chiến dịch", icon: <Bot className="size-3.5" />, ph: "vd: chiến dịch win-back khách VIP sắp rời, tặng ưu đãi qua email" },
];

/** Trợ lý AI (generative, LLM). Gọi /v1/ai/assistant/*. Cần ANTHROPIC_API_KEY (ENV) để dùng thật. */
export function AssistantScreen() {
  const [mode, setMode] = useState<Mode>("ask");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [seg, setSeg] = useState<{ criteria: Record<string, unknown>; preview: SegmentPreview } | null>(null);
  const [nlq, setNlq] = useState<NlqResult | null>(null);
  const [copilot, setCopilot] = useState<CopilotResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() { setText(null); setSeg(null); setNlq(null); setCopilot(null); setError(null); }

  async function run() {
    if (!input.trim()) return;
    setBusy(true); reset();
    try {
      if (mode === "ask") setText((await api.assistantAsk(input.trim())).text);
      else if (mode === "content") setText((await api.assistantContent(input.trim())).text);
      else if (mode === "query") setNlq(await api.askData(input.trim()));
      else if (mode === "copilot") setCopilot(await api.runCopilot(input.trim()));
      else {
        const r = await api.assistantSegment(input.trim());
        setSeg({ criteria: r.criteria as unknown as Record<string, unknown>, preview: r.preview });
      }
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "Lỗi không xác định");
    } finally {
      setBusy(false);
    }
  }

  const cur = MODES.find((m) => m.value === mode)!;
  return (
    <div className="mx-auto max-w-[900px] p-6">
      <PageHeader
        title="Trợ lý AI"
        description="Hỏi dữ liệu bằng ngôn ngữ tự nhiên, tạo segment từ mô tả, hoặc sinh nội dung marketing."
        breadcrumb={["AI", "Trợ lý AI"]}
        badge={<Badge tone="violet" icon={<Sparkles className="size-3" />}>Generative</Badge>}
      />

      <Panel bodyClassName="p-4">
        <SegmentedControl
          className="mb-3"
          items={MODES.map((m) => ({ value: m.value, label: m.label, icon: m.icon }))}
          value={mode}
          onChange={(v) => { setMode(v as Mode); reset(); }}
        />
        <Textarea
          aria-label="Nội dung yêu cầu"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={cur.ph}
          rows={3}
        />
        <div className="mt-3 flex items-center gap-3">
          <Button variant="primary" onClick={run} disabled={busy || !input.trim()} loading={busy} icon={<Sparkles className="size-4" />}>
            {busy ? "Đang xử lý…" : "Gửi"}
          </Button>
          <span className="text-xs text-text-subtle">Guardrail PII: chỉ dữ liệu phi-PII được gửi tới LLM.</span>
        </div>
      </Panel>

      {error && (
        <div className="mt-4">
          <EmptyState
            tone="error"
            icon={<ShieldAlert className="size-6" />}
            title={error}
            description={error.includes("LLM_NOT_CONFIGURED") ? "Đặt ANTHROPIC_API_KEY trong ENV của core-api để dùng tính năng generative." : undefined}
          />
        </div>
      )}

      {text && (
        <Panel className="mt-4" title="Kết quả" icon={<Sparkles className="size-4" />} testid="assistant-result">
          <p className="whitespace-pre-wrap text-sm text-text">{text}</p>
        </Panel>
      )}

      {seg && (
        <Panel className="mt-4" title="Segment sinh ra" icon={<Target className="size-4" />} testid="assistant-segment">
          <p className="text-sm text-text">Khớp <span className="font-bold text-accent">{fmtInt(seg.preview.count)}</span> khách.</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-surface-alt p-3 font-mono text-xs text-text">{JSON.stringify(seg.criteria, null, 2)}</pre>
        </Panel>
      )}

      {nlq && <NlqResultView nlq={nlq} />}

      {copilot && <CopilotView result={copilot} />}
    </div>
  );
}

const STEP_ICON = {
  ok: <CheckCircle2 className="size-4 text-success" />,
  skipped: <SkipForward className="size-4 text-text-subtle" />,
  error: <XCircle className="size-4 text-error" />,
};
function CopilotView({ result }: { result: CopilotResult }) {
  const nav = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);

  async function createDraft() {
    if (!result.proposedJourney) return;
    setCreating(true);
    try {
      const j = await api.jCreateJourney({ name: result.proposedJourney.name });
      toast.push("Đã tạo journey nháp — hoàn thiện trên canvas", "success");
      nav(`/journeys/${j.journey_id}`);
    } catch (e) {
      toast.push(e instanceof ApiError ? e.message : "Lỗi tạo journey", "error");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panel className="mt-4" title="Copilot — chuỗi chiến dịch" icon={<Bot className="size-4" />}
      actions={<Badge tone="violet">human-in-the-loop</Badge>}>
      <ol className="relative space-y-4 border-l border-border pl-6">
        {result.steps.map((s) => (
          <li key={s.key} className="relative">
            <span className="absolute -left-[31px] top-0.5 grid size-5 place-items-center rounded-full border-2 border-surface bg-surface">{STEP_ICON[s.status]}</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-text">{s.title}</span>
              <StatusPill tone={s.status === "ok" ? "success" : s.status === "skipped" ? "neutral" : "error"}>{s.status}</StatusPill>
            </div>
            <p className="mt-0.5 text-sm text-text-muted">{s.summary}</p>
            {s.key === "content" && s.status === "ok" && (s.artifact as { text?: string })?.text && (
              <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-surface-alt p-3 text-xs text-text">{(s.artifact as { text: string }).text}</pre>
            )}
          </li>
        ))}
      </ol>
      {result.proposedJourney && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt px-4 py-3">
          <div>
            <div className="text-sm font-semibold text-text">{result.proposedJourney.name}</div>
            <div className="text-xs text-text-muted">Đề xuất: {result.proposedJourney.action} · cần người duyệt</div>
          </div>
          <Button variant="primary" icon={<Wand2 className="size-4" />} onClick={createDraft} loading={creating}>Tạo journey nháp</Button>
        </div>
      )}
    </Panel>
  );
}

function NlqResultView({ nlq }: { nlq: NlqResult }) {
  const cols: Column<{ label: string; value: number }>[] = [
    { key: "label", header: nlq.columns[0] ?? "Nhãn", cell: (r) => <span className="font-medium text-text">{r.label}</span> },
    { key: "value", header: nlq.columns[1] ?? "Giá trị", numeric: true, cell: (r) => <span className="font-semibold tabular">{fmtInt(r.value)}</span> },
  ];
  return (
    <Panel className="mt-4" title={nlq.answered} icon={<Database className="size-4" />}
      actions={<Badge tone="neutral">truy vấn an toàn (chỉ SELECT)</Badge>}>
      {nlq.chartType !== "single" && nlq.rows.length > 1 && (
        <div className="mb-3">
          {nlq.chartType === "line"
            ? <AnomalyLine height={220} data={nlq.rows.map((r) => ({ period: r.label, value: r.value }))} valueFormatter={fmtInt} />
            : <BarChart height={Math.max(180, nlq.rows.length * 34)} data={nlq.rows.map((r) => ({ label: r.label, value: r.value }))} valueFormatter={fmtInt} />}
        </div>
      )}
      {nlq.chartType === "single" ? (
        <div className="text-2xl font-bold text-accent tabular">{fmtInt(nlq.rows[0]?.value ?? 0)}</div>
      ) : (
        <Table columns={cols} rows={nlq.rows} rowKey={(r, i) => `${r.label}-${i}`} density="compact" />
      )}
      <details className="mt-3 text-xs text-text-subtle">
        <summary className="cursor-pointer">Xem truy vấn đã chạy</summary>
        <pre className="mt-1 overflow-x-auto rounded bg-surface-alt p-2 font-mono">{nlq.sql}</pre>
      </details>
    </Panel>
  );
}
