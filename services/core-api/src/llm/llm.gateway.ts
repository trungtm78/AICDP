import type { Pool } from "pg";
import { getConfig, type LlmProvider } from "../ai-config/ai-config.service.js";
import { AppError } from "../http/errors.js";

// LLM Gateway provider-agnostic. Đọc ai_config.llm chọn provider+model THEO TASK. Mặc định
// Anthropic Claude (claude-api skill: model claude-opus-4-8 / haiku-4-5). API key qua ENV
// (KHÔNG lưu DB). Provider injectable cho test (không gọi mạng). Mọi call ghi ai_llm_usage.
// ⚠️ GUARDRAIL PII: chỉ truyền dữ liệu phi-PII/tổng hợp vào prompt (xem assistant.service).

export type LlmTask = "ask" | "segment" | "content" | "explain";

export interface LlmCallOpts {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}
export interface LlmCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export type ProviderFn = (opts: LlmCallOpts) => Promise<LlmCallResult>;

// ── Anthropic adapter (mặc định) — dynamic import để test không cần SDK/mạng ──
const anthropicProvider: ProviderFn = async (opts) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new AppError({ code: "LLM_NOT_CONFIGURED", httpStatus: 503, message: "Thiếu ANTHROPIC_API_KEY", why: "Provider anthropic chưa cấu hình key.", fix: "Đặt ENV ANTHROPIC_API_KEY." });
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey: key });
  const res = await client.messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
  });
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
};

// ── OpenAI adapter (Chat Completions qua fetch — không cần SDK) ──
const openaiProvider: ProviderFn = async (opts) => {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new AppError({ code: "LLM_NOT_CONFIGURED", httpStatus: 503, message: "Thiếu OPENAI_API_KEY", why: "Provider openai chưa cấu hình key.", fix: "Đặt ENV OPENAI_API_KEY." });
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: opts.model,
        max_completion_tokens: opts.maxTokens,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Lỗi mạng/timeout (không ra được api.openai.com) -> AppError sạch (không để thành 500).
    throw new AppError({ code: "LLM_NOT_CONFIGURED", httpStatus: 503, message: "Không gọi được OpenAI", why: (err as Error).message, fix: "Kiểm tra kết nối mạng ra api.openai.com hoặc chọn provider khác." });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError({ code: "LLM_NOT_CONFIGURED", httpStatus: 502, message: `OpenAI lỗi ${res.status}`, why: detail.slice(0, 300), fix: "Kiểm tra OPENAI_API_KEY / model trong AI Settings." });
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, inputTokens: data.usage?.prompt_tokens ?? 0, outputTokens: data.usage?.completion_tokens ?? 0 };
};

const notConfigured = (name: string): ProviderFn => async () => {
  throw new AppError({ code: "LLM_NOT_CONFIGURED", httpStatus: 503, message: `Provider ${name} chưa được tích hợp/cấu hình`, why: "Adapter chưa bật hoặc thiếu key.", fix: `Cấu hình ENV cho ${name} hoặc chọn provider khác trong AI Settings.` });
};

const providers: Record<LlmProvider, ProviderFn> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: notConfigured("gemini"),
};

/** Test-only: thay provider thật bằng fake (không gọi mạng). */
export function __setProvider(name: LlmProvider, fn: ProviderFn): void {
  providers[name] = fn;
}

/**
 * Thực thi 1 task generative: chọn provider+model theo ai_config, kiểm feature.assistant bật,
 * gọi provider, GHI ai_llm_usage. Trả text. PII: caller phải đảm bảo prompt không chứa PII.
 */
export async function runLlmTask(
  pool: Pool,
  task: LlmTask,
  args: { system: string; user: string; maxTokens?: number; principalId?: string },
): Promise<{ text: string; provider: LlmProvider; model: string }> {
  const cfg = await getConfig(pool);
  if (!cfg.features.assistant) {
    throw new AppError({ code: "LLM_DISABLED", httpStatus: 409, message: "Tính năng AI Assistant đang tắt", why: "features.assistant=false trong AI config.", fix: "Bật trong AI Settings (admin)." });
  }
  // Hạn mức LLM per-principal/ngày (chống đội hoá đơn khi rate-limit chưa đủ). 0 = tắt.
  const dailyCap = Number(process.env.LLM_DAILY_CALL_CAP ?? 0);
  if (args.principalId && dailyCap > 0) {
    const used = await pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM cdp.ai_llm_usage WHERE principal_id=$1 AND created_at >= date_trunc('day', now())",
      [args.principalId],
    );
    if (Number(used.rows[0]!.n) >= dailyCap) {
      throw new AppError({ code: "RATE_LIMIT_SOURCE_BURST", httpStatus: 429, message: "Vượt hạn mức gọi AI trong ngày", why: `principal đã dùng >= ${dailyCap} lượt LLM hôm nay.`, fix: "Thử lại ngày mai hoặc tăng LLM_DAILY_CALL_CAP.", retryable: false });
    }
  }
  const taskCfg = cfg.llm.tasks[task];
  const fn = providers[taskCfg.provider];
  const result = await fn({
    model: taskCfg.model,
    system: args.system,
    user: args.user,
    maxTokens: args.maxTokens ?? 1024,
  });
  await pool.query(
    `INSERT INTO cdp.ai_llm_usage (task, provider, model, input_tokens, output_tokens, principal_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [task, taskCfg.provider, taskCfg.model, result.inputTokens, result.outputTokens, args.principalId ?? null],
  );
  return { text: result.text, provider: taskCfg.provider, model: taskCfg.model };
}
