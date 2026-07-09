import { useState } from "react";
import { api } from "../lib/api.js";
import { ApiError, type SegmentPreview } from "../lib/types.js";

type Mode = "ask" | "segment" | "content";
const MODES: { id: Mode; label: string; ph: string }[] = [
  { id: "ask", label: "Hỏi dữ liệu", ph: "vd: Hệ thống có bao nhiêu khách VIP?" },
  { id: "segment", label: "Tạo segment", ph: "vd: khách VIP chi tiêu trên 5 triệu, đã đồng ý email" },
  { id: "content", label: "Sinh nội dung", ph: "vd: viết tin nhắn khuyến mãi bánh trung thu cho khách thân thiết" },
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

  const cur = MODES.find((m) => m.id === mode)!;
  return (
    <section className="mx-auto max-w-[900px] p-6">
      <header className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Trợ lý AI</h1>
        <p className="text-text-muted">Hỏi dữ liệu bằng ngôn ngữ tự nhiên, tạo segment từ mô tả, hoặc sinh nội dung marketing.</p>
      </header>

      <div className="mb-3 inline-flex rounded-lg border border-border bg-surface p-1">
        {MODES.map((m) => (
          <button key={m.id} type="button" onClick={() => { setMode(m.id); setText(null); setSeg(null); setError(null); }}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === m.id ? "bg-accent text-white" : "text-text-muted hover:bg-surface-alt"}`}>
            {m.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <textarea
          aria-label="Nội dung yêu cầu"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={cur.ph}
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-surface-alt px-3 py-2 text-sm"
        />
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={run} disabled={busy || !input.trim()}
            className="rounded-md bg-accent px-4 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "Đang xử lý…" : "Gửi"}
          </button>
          <span className="text-xs text-text-subtle">Guardrail PII: chỉ dữ liệu phi-PII được gửi tới LLM.</span>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-error/40 bg-error/10 p-4 text-sm text-error">
          {error}
          {error.includes("LLM_NOT_CONFIGURED") && (
            <p className="mt-1 text-text-muted">Đặt ANTHROPIC_API_KEY trong ENV của core-api để dùng tính năng generative.</p>
          )}
        </div>
      )}

      {text && (
        <div data-testid="assistant-result" className="mt-4 rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-subtle">Kết quả</div>
          <p className="whitespace-pre-wrap text-sm">{text}</p>
        </div>
      )}

      {seg && (
        <div data-testid="assistant-segment" className="mt-4 rounded-lg border border-border bg-surface p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-text-subtle">Segment sinh ra</div>
          <p className="text-sm">Khớp <span className="font-bold text-accent">{seg.preview.count}</span> khách.</p>
          <pre className="mt-2 overflow-x-auto rounded-md bg-surface-alt p-2 font-mono text-xs">{JSON.stringify(seg.criteria, null, 2)}</pre>
        </div>
      )}
    </section>
  );
}
