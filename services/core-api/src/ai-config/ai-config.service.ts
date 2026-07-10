import type { Pool } from "pg";

// AI Config & Governance: nguồn tham số cho mọi tính năng AI (reco/RFM/forecast/decisioning/LLM).
// DEFAULTS ở đây là NGUỒN CHÂN LÝ — bảng cdp.ai_config rỗng vẫn chạy an toàn. Mọi thay đổi qua
// setConfig() ghi audit bất biến. Service đọc getConfig() (KHÔNG nhận tham số từ client) =>
// enforcement server-side: bật/tắt + ngưỡng AI do admin kiểm soát, không bypass bằng request.

export type LlmProvider = "anthropic" | "openai" | "gemini";
export type PiiPolicy = "redact" | "block" | "allow";

export interface LlmTaskConfig {
  provider: LlmProvider;
  model: string;
}

export interface AiConfig {
  rfm: {
    vipFreq: number;
    vipMonetary: number;
    atRiskGapDays: number;
    churnGapDays: number;
    dormantGapDays: number;
  };
  reco: {
    topN: number;
    diversityWeight: number; // 0..1: càng cao càng đa dạng category
    enableCrossBrand: boolean;
    enableMarketBasket: boolean;
    boost: string[]; // product_master_id/category được đẩy lên
    bury: string[]; // bị loại/đẩy xuống
  };
  forecast: {
    periods: number; // số kỳ dự báo
    window: number; // độ rộng moving-average
    granularity: "week" | "month";
  };
  decisioning: {
    enabled: boolean;
  };
  ml: {
    enabled: boolean; // bật gọi ai-service; tắt -> luôn dùng heuristic
    useForFeature: boolean; // dùng điểm ML (churn/propensity) ở tầng feature/decisioning
    useForClv: boolean; // dùng CLV/next-purchase ML trong customer-analytics
    churnThreshold: number; // 0..1 ngưỡng "churn cao" cho decisioning/segment
    propensityHorizonDays: number; // horizon nhãn propensity (khớp ai-service)
    minAuc: number; // ngưỡng tối thiểu để hiển thị model là "tin cậy"
  };
  features: {
    recoV2: boolean;
    nba: boolean;
    forecast: boolean;
    assistant: boolean;
  };
  llm: {
    defaultProvider: LlmProvider;
    piiPolicy: PiiPolicy;
    tasks: {
      ask: LlmTaskConfig;
      segment: LlmTaskConfig;
      content: LlmTaskConfig;
      explain: LlmTaskConfig;
    };
  };
}

export type AiConfigSection = keyof AiConfig;

// Model Claude mới nhất (CLAUDE.md: build AI app dùng Claude mới nhất). Đọc skill `claude-api`
// để xác nhận id khi tích hợp SDK thật.
const CLAUDE_OPUS = "claude-opus-4-8";
const CLAUDE_HAIKU = "claude-haiku-4-5-20251001";

export const DEFAULT_AI_CONFIG: AiConfig = {
  rfm: { vipFreq: 5, vipMonetary: 5_000_000, atRiskGapDays: 60, churnGapDays: 180, dormantGapDays: 90 },
  reco: { topN: 10, diversityWeight: 0.3, enableCrossBrand: true, enableMarketBasket: true, boost: [], bury: [] },
  forecast: { periods: 4, window: 4, granularity: "week" },
  decisioning: { enabled: true },
  ml: { enabled: true, useForFeature: true, useForClv: true, churnThreshold: 0.6, propensityHorizonDays: 30, minAuc: 0.6 },
  features: { recoV2: true, nba: true, forecast: true, assistant: true },
  llm: {
    defaultProvider: "anthropic",
    piiPolicy: "redact",
    tasks: {
      ask: { provider: "anthropic", model: CLAUDE_OPUS },
      segment: { provider: "anthropic", model: CLAUDE_HAIKU },
      content: { provider: "anthropic", model: CLAUDE_OPUS },
      explain: { provider: "anthropic", model: CLAUDE_HAIKU },
    },
  },
};

const SECTIONS = Object.keys(DEFAULT_AI_CONFIG) as AiConfigSection[];

export class AiConfigError extends Error {
  constructor(public readonly code: "UNKNOWN_SECTION", message: string) {
    super(message);
    this.name = "AiConfigError";
  }
}

/**
 * Cấu hình AI hiệu lực = DEFAULTS merge với override trong DB (shallow per-section).
 * Bảng rỗng -> trả nguyên DEFAULTS. Section trong DB ghi đè field tương ứng của DEFAULTS.
 */
export async function getConfig(pool: Pool): Promise<AiConfig> {
  const r = await pool.query<{ key: string; value: Record<string, unknown> }>(
    "SELECT key, value FROM cdp.ai_config",
  );
  const overrides = new Map(r.rows.map((row) => [row.key, row.value]));
  const cfg = structuredClone(DEFAULT_AI_CONFIG);
  const bag = cfg as unknown as Record<string, Record<string, unknown>>;
  for (const section of SECTIONS) {
    const ov = overrides.get(section);
    if (ov && typeof ov === "object") {
      // merge nông: field override thay default, mảng/đối tượng con thay nguyên.
      bag[section] = { ...bag[section], ...ov };
    }
  }
  return cfg;
}

export interface AiConfigAuditEntry {
  id: string;
  key: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  changed_by: string;
  changed_at: string;
}

/**
 * Ghi đè cấu hình MỘT section (admin). Transaction: lấy giá trị cũ -> upsert -> ghi audit.
 * Section không hợp lệ -> AiConfigError (controller map sang 400).
 */
export async function setConfig(
  pool: Pool,
  section: string,
  value: Record<string, unknown>,
  changedBy: string,
): Promise<AiConfig> {
  if (!SECTIONS.includes(section as AiConfigSection)) {
    throw new AiConfigError("UNKNOWN_SECTION", `Section AI config không hợp lệ: ${section}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query<{ value: Record<string, unknown> }>(
      "SELECT value FROM cdp.ai_config WHERE key=$1 FOR UPDATE",
      [section],
    );
    const oldValue = old.rows[0]?.value ?? null;
    await client.query(
      `INSERT INTO cdp.ai_config (key, value, updated_by, updated_at)
       VALUES ($1,$2,$3, now())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [section, JSON.stringify(value), changedBy],
    );
    await client.query(
      `INSERT INTO cdp.ai_config_audit (key, old_value, new_value, changed_by)
       VALUES ($1,$2,$3,$4)`,
      [section, oldValue === null ? null : JSON.stringify(oldValue), JSON.stringify(value), changedBy],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return getConfig(pool);
}

export async function listAudit(pool: Pool, limit = 100): Promise<AiConfigAuditEntry[]> {
  const r = await pool.query<AiConfigAuditEntry>(
    `SELECT id::text, key, old_value, new_value, changed_by, changed_at
       FROM cdp.ai_config_audit ORDER BY changed_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}

export interface LlmUsageEntry {
  id: string;
  task: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  principal_id: string | null;
  created_at: string;
}

/** Lịch sử gọi LLM (token/cost) cho tab LLM Usage trong AI Governance. */
export async function listUsage(pool: Pool, limit = 100): Promise<LlmUsageEntry[]> {
  const r = await pool.query<LlmUsageEntry>(
    `SELECT id::text, task, provider, model, input_tokens, output_tokens, principal_id, created_at
       FROM cdp.ai_llm_usage ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}
