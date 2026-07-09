// Cầu nối tới ai-service (ML). Circuit-breaker + timeout ngắn — khi ai-service down/timeout,
// throw PredictionUnavailable để prediction.service FALLBACK heuristic. core-api LUÔN sống.
// Pattern port từ analytics.service.ts (chOpenUntilMs). KHÔNG depends_on cứng ai-service.

export interface MlPrediction {
  occId: string;
  churnProb: number;
  propensity: number;
  clv: number;
  predictedPurchases: number;
  nextIntervalDays: number;
  nextPurchaseAt: string | null;
  reasons: { churn: string[]; propensity: string[] };
  modelVersions: Record<string, string>;
}

export interface Similar {
  occId: string;
  similarity: number;
}

export interface IPredictionProvider {
  /** Chấm điểm ML cho danh sách occ (rỗng = toàn bộ). Throw PredictionUnavailable nếu ai-service không sẵn. */
  score(occIds: string[]): Promise<MlPrediction[]>;
  lookalike(seedOccIds: string[], limit: number): Promise<Similar[]>;
  health(): Promise<boolean>;
}

export const PREDICTION_PROVIDER = Symbol("PREDICTION_PROVIDER");

export class PredictionUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictionUnavailable";
  }
}

const AI_COOLDOWN_MS = 15_000;
const AI_TIMEOUT_MS = 4_000; // scoring batch có thể lâu hơn 500ms; giữ vừa phải
let aiOpenUntilMs = 0;

interface RawScore {
  occId: string;
  churn?: { score?: number; reasons?: string[] };
  propensity?: { score?: number; reasons?: string[] };
  clv?: { value?: number; predictedPurchases?: number };
  nextPurchase?: { intervalDays?: number; predictedAt?: string };
  modelVersions?: Record<string, string>;
}

function mapScore(r: RawScore): MlPrediction {
  return {
    occId: r.occId,
    churnProb: r.churn?.score ?? 0,
    propensity: r.propensity?.score ?? 0,
    clv: Math.round(r.clv?.value ?? 0),
    predictedPurchases: r.clv?.predictedPurchases ?? 0,
    nextIntervalDays: r.nextPurchase?.intervalDays ?? 0,
    nextPurchaseAt: r.nextPurchase?.predictedAt ?? null,
    reasons: { churn: r.churn?.reasons ?? [], propensity: r.propensity?.reasons ?? [] },
    modelVersions: r.modelVersions ?? {},
  };
}

export class HttpPredictionProvider implements IPredictionProvider {
  constructor(private readonly baseUrl = process.env.AI_SERVICE_URL ?? "") {}

  private ensureUp(): void {
    if (!this.baseUrl) throw new PredictionUnavailable("AI_SERVICE_URL chưa cấu hình");
    if (Date.now() < aiOpenUntilMs) throw new PredictionUnavailable("Circuit mở (ai-service vừa lỗi)");
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    this.ensureUp();
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`ai-service ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      aiOpenUntilMs = Date.now() + AI_COOLDOWN_MS;
      throw new PredictionUnavailable((err as Error).message);
    }
  }

  async score(occIds: string[]): Promise<MlPrediction[]> {
    const data = await this.call<{ predictions: RawScore[] }>("/v1/score/batch", { occIds });
    return (data.predictions ?? []).map(mapScore);
  }

  async lookalike(seedOccIds: string[], limit: number): Promise<Similar[]> {
    const data = await this.call<{ results: Similar[] }>("/v1/lookalike", { seedOccIds, limit });
    return data.results ?? [];
  }

  async health(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const res = await fetch(`${this.baseUrl}/v1/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const predictionProviderProvider = {
  provide: PREDICTION_PROVIDER,
  useFactory: (): IPredictionProvider => new HttpPredictionProvider(),
};
