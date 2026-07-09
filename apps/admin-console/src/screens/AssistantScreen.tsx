import { useState } from "react";
import { MessageSquare, Target, PenLine, Sparkles, ShieldAlert } from "lucide-react";
import { api } from "../lib/api.js";
import { ApiError, type SegmentPreview } from "../lib/types.js";
import { fmtInt } from "../lib/format.js";
import { PageHeader, Panel, SegmentedControl, Textarea, Button, EmptyState, Badge } from "../ui/index.js";

type Mode = "ask" | "segment" | "content";
const MODES: { value: Mode; label: string; icon: React.ReactNode; ph: string }[] = [
  { value: "ask", label: "Hỏi dữ liệu", icon: <MessageSquare className="size-3.5" />, ph: "vd: Hệ thống có bao nhiêu khách VIP?" },
  { value: "segment", label: "Tạo segment", icon: <Target className="size-3.5" />, ph: "vd: khách VIP chi tiêu trên 5 triệu, đã đồng ý email" },
  { value: "content", label: "Sinh nội dung", icon: <PenLine className="size-3.5" />, ph: "vd: viết tin nhắn khuyến mãi bánh trung thu cho khách thân thiết" },
];

/** Trợ lý AI (generative, LLM). Gọi /v1/ai/assistant/*. Cần ANTHROPIC_API_KEY (ENV) để dùng thật. */
export function AssistantScreen() {
  const [mode, setMode] = useState<Mode>("ask");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [seg, setSeg] = useState<{ criteria: Record<string, unknown>; preview: SegmentPreview } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (!input.trim()) return;
    setBusy(true); setText(null); setSeg(null); setError(null);
    try {
      if (mode === "ask") setText((await api.assistantAsk(input.trim())).text);
      else if (mode === "content") setText((await api.assistantContent(input.trim())).text);
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
          onChange={(v) => { setMode(v as Mode); setText(null); setSeg(null); setError(null); }}
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
    </div>
  );
}
