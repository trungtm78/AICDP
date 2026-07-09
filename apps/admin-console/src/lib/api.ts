import { getToken, clearSession } from "./auth.js";
import {
  ApiError,
  type Brand,
  type Store,
  type Product,
  type Customer360,
  type CustomerAnalytics,
  type CustomerListItem,
  type ConnectorCatalog,
  type Connection,
  type Pipeline,
  type IdentifierType,
  type LoyaltyBalance,
  type LoyaltyMember,
  type LoyaltyLedgerEntry,
  type ActivationMember,
  type TransactionDetail,
  type LoyaltyResult,
  type ReserveResult,
  type ConsentState,
  type ConsentPurpose,
  type ActivateArgs,
  type ActivateResult,
  type ActivationRun,
  type Overview,
  type SegmentCriteria,
  type SegmentPreview,
  type Recommendation,
  type Journey,
  type JourneyRunResult,
  type CreateJourneyArgs,
  type Role,
  type UserSummary,
  type ApiKeySummary,
  type CreatedApiKey,
  type AiConfig,
  type AiConfigSection,
  type AiConfigAuditEntry,
  type LlmUsageEntry,
  type CustomerFeature,
  type RecommendationV2,
  type NbaDecision,
  type ForecastResult,
  type Insights,
  type JTrigger,
  type JourneyDefinition,
  type JourneyRow,
  type JourneySummary,
  type JourneyParticipant,
  type JourneyReport,
} from "./types.js";

// Client gọi core-api qua proxy /v1. Mọi data hiển thị đều lấy từ đây (không hardcode).

interface Envelope<T> {
  data: T;
  meta?: Record<string, unknown>;
}

// Rỗng (mặc định) = same-origin: dev qua Vite proxy /v1, prod cần reverse-proxy /v1 -> core-api.
// Đặt VITE_API_BASE_URL khi admin-console và core-api khác origin.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function rawRequest<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  // JWT từ phiên đăng nhập (không nhúng credential vào bundle). Login là public nên
  // không cần token. 401 -> xoá phiên để App quay về màn đăng nhập.
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
    if (res.status === 401) clearSession();
    throw new ApiError(
      err.message ?? `Lỗi ${res.status}`,
      err.code ?? "UNKNOWN",
      res.status,
      err.field_path ?? null,
    );
  }
  return body as Envelope<T>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  return (await rawRequest<T>(path, init)).data;
}

/** Như request nhưng trả kèm meta (vd participants: meta.total). */
async function requestFull<T>(path: string, init?: RequestInit): Promise<{ data: T; meta: { total: number } }> {
  const env = await rawRequest<T>(path, init);
  return { data: env.data, meta: { total: Number((env.meta?.total as number) ?? 0) } };
}

/** Trả kèm TOÀN BỘ meta (nhiều field). */
async function requestEnvelope<T>(path: string, init?: RequestInit): Promise<{ data: T; meta: Record<string, unknown> }> {
  const env = await rawRequest<T>(path, init);
  return { data: env.data, meta: env.meta ?? {} };
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; role: string; name: string }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  /** Quên mật khẩu — resetToken chỉ có ở chế độ demo (CORE_API_DEMO_RESET=1). */
  requestPasswordReset: (username: string) =>
    request<{ ok: true; resetToken?: string }>("/v1/auth/password-reset/request", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),

  confirmPasswordReset: (token: string, newPassword: string) =>
    request<{ ok: true }>("/v1/auth/password-reset/confirm", {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    }),

  listBrands: () => request<Brand[]>("/v1/brands"),

  listStores: (brandId?: string) =>
    request<Store[]>(`/v1/stores${brandId ? `?brand_id=${encodeURIComponent(brandId)}` : ""}`),

  createStore: (dto: {
    store_id: string;
    brand_id: string;
    name: string;
    region?: string;
    city?: string;
    address?: string;
  }) => request<{ store_id: string }>("/v1/stores", { method: "POST", body: JSON.stringify(dto) }),

  listProducts: () => request<Product[]>("/v1/products"),

  createProduct: (dto: {
    product_master_id: string;
    name: string;
    category_id?: string;
    unit?: string;
  }) =>
    request<{ product_master_id: string }>("/v1/products", {
      method: "POST",
      body: JSON.stringify(dto),
    }),

  updateStore: (id: string, patch: { name?: string; brand_id?: string; region?: string; city?: string; address?: string }) =>
    request<{ store_id: string }>(`/v1/stores/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteStore: (id: string) =>
    request<{ deleted: true }>(`/v1/stores/${encodeURIComponent(id)}`, { method: "DELETE" }),

  updateProduct: (id: string, patch: { name?: string; category_id?: string; unit?: string }) =>
    request<{ product_master_id: string }>(`/v1/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteProduct: (id: string) =>
    request<{ deleted: true }>(`/v1/products/${encodeURIComponent(id)}`, { method: "DELETE" }),

  createBrand: (dto: { brand_id: string; name: string; industry?: string; brand_accent?: string }) =>
    request<{ brand_id: string }>("/v1/brands", { method: "POST", body: JSON.stringify(dto) }),
  updateBrand: (id: string, patch: { name?: string; industry?: string; brand_accent?: string }) =>
    request<{ brand_id: string }>(`/v1/brands/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteBrand: (id: string) =>
    request<{ deleted: true }>(`/v1/brands/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /** Danh sách khách hàng (directory) — trả kèm total để phân trang. */
  listCustomers: (params: { search?: string; lifecycle?: string; brand?: string; limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search);
    if (params.lifecycle) qs.set("lifecycle", params.lifecycle);
    if (params.brand) qs.set("brand", params.brand);
    qs.set("limit", String(params.limit ?? 25));
    qs.set("offset", String(params.offset ?? 0));
    return requestFull<CustomerListItem[]>(`/v1/customers?${qs.toString()}`);
  },

  lookupCustomer: (type: IdentifierType, value: string) =>
    request<Customer360>(
      `/v1/customers/lookup?type=${encodeURIComponent(type)}&value=${encodeURIComponent(value)}`,
    ),

  getCustomerByOcc: (occId: string) =>
    request<Customer360>(`/v1/customers/by-id/${encodeURIComponent(occId)}`),

  getCustomerAnalytics: (occId: string) =>
    request<CustomerAnalytics>(`/v1/customers/by-id/${encodeURIComponent(occId)}/analytics`),

  getLoyaltyBalance: (occId: string) =>
    request<LoyaltyBalance>(`/v1/loyalty/balance?occId=${encodeURIComponent(occId)}`),

  listLoyaltyMembers: () => requestEnvelope<LoyaltyMember[]>("/v1/loyalty/members"),

  getLoyaltyLedger: (occId: string) =>
    request<LoyaltyLedgerEntry[]>(`/v1/loyalty/ledger?occId=${encodeURIComponent(occId)}`),

  loyaltyEarn: (occId: string, points: number, idempotencyKey: string) =>
    request<LoyaltyResult>("/v1/loyalty/earn", {
      method: "POST",
      body: JSON.stringify({ occId, points, idempotencyKey }),
    }),

  loyaltyReserve: (occId: string, points: number, idempotencyKey: string) =>
    request<ReserveResult>("/v1/loyalty/reserve", {
      method: "POST",
      body: JSON.stringify({ occId, points, idempotencyKey }),
    }),

  // capture/release gắn vào MỘT reservation cụ thể (state machine held->captured|released).
  loyaltyCapture: (reservationId: string, idempotencyKey: string) =>
    request<LoyaltyResult>("/v1/loyalty/capture", {
      method: "POST",
      body: JSON.stringify({ reservationId, idempotencyKey }),
    }),

  loyaltyRelease: (reservationId: string, idempotencyKey: string) =>
    request<LoyaltyResult>("/v1/loyalty/release", {
      method: "POST",
      body: JSON.stringify({ reservationId, idempotencyKey }),
    }),

  listConsents: (occId: string) =>
    request<ConsentState[]>(`/v1/consent?occId=${encodeURIComponent(occId)}`),

  recordConsent: (
    occId: string,
    purpose: ConsentPurpose,
    status: "granted" | "withdrawn",
    source: string,
  ) =>
    request<ConsentState>("/v1/consent", {
      method: "POST",
      body: JSON.stringify({ occId, purpose, status, source }),
    }),

  activate: (args: ActivateArgs) =>
    request<ActivateResult>("/v1/activation", {
      method: "POST",
      body: JSON.stringify(args),
    }),

  listActivationRuns: () => request<ActivationRun[]>("/v1/activation"),

  getActivationMembers: (runId: string) =>
    request<ActivationMember[]>(`/v1/activation/${encodeURIComponent(runId)}/members`),

  getTransactionDetail: (occId: string, messageId: string) =>
    request<TransactionDetail>(
      `/v1/customers/by-id/${encodeURIComponent(occId)}/transactions/${encodeURIComponent(messageId)}`,
    ),

  getOverview: () => request<Overview>("/v1/analytics/overview"),

  previewSegment: (criteria: SegmentCriteria) =>
    request<SegmentPreview>("/v1/segments/preview", {
      method: "POST",
      body: JSON.stringify(criteria),
    }),

  getRecommendations: (occId: string) =>
    request<{ occId: string; recommendations: Recommendation[] }>(
      `/v1/ai/recommendations?occId=${encodeURIComponent(occId)}`,
    ),

  listJourneys: () => request<Journey[]>("/v1/journeys"),

  createJourney: (args: CreateJourneyArgs) =>
    request<Journey>("/v1/journeys", { method: "POST", body: JSON.stringify(args) }),

  runJourney: (journeyId: string) =>
    request<JourneyRunResult>(`/v1/journeys/${encodeURIComponent(journeyId)}/run`, {
      method: "POST",
    }),

  // ── Journey engine (M1–M5) ──
  jListJourneys: () => request<JourneySummary[]>("/v1/journeys"),
  jGetJourney: (id: string) => request<JourneyRow>(`/v1/journeys/${encodeURIComponent(id)}`),
  jCreateJourney: (dto: { name: string; triggerType?: JTrigger; triggerConfig?: Record<string, unknown>; definition?: JourneyDefinition }) =>
    request<JourneyRow>("/v1/journeys", { method: "POST", body: JSON.stringify(dto) }),
  jSaveJourney: (id: string, dto: { name?: string; triggerType?: JTrigger; triggerConfig?: Record<string, unknown>; definition?: JourneyDefinition }) =>
    request<JourneyRow>(`/v1/journeys/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(dto) }),
  jPublish: (id: string) => request<{ version: number }>(`/v1/journeys/${encodeURIComponent(id)}/publish`, { method: "POST" }),
  jActivate: (id: string) => request<JourneyRow>(`/v1/journeys/${encodeURIComponent(id)}/activate`, { method: "POST" }),
  jPause: (id: string) => request<JourneyRow>(`/v1/journeys/${encodeURIComponent(id)}/pause`, { method: "POST" }),
  jArchive: (id: string) => request<JourneyRow>(`/v1/journeys/${encodeURIComponent(id)}/archive`, { method: "POST" }),
  jEnroll: (id: string, body: { occIds?: string[]; useSegment?: boolean }) =>
    request<{ enrolled: number }>(`/v1/journeys/${encodeURIComponent(id)}/enroll`, { method: "POST", body: JSON.stringify(body) }),
  jParticipants: (id: string, q: { status?: string; nodeId?: string; limit?: number; offset?: number } = {}) => {
    const p = new URLSearchParams();
    if (q.status) p.set("status", q.status);
    if (q.nodeId) p.set("nodeId", q.nodeId);
    if (q.limit) p.set("limit", String(q.limit));
    if (q.offset) p.set("offset", String(q.offset));
    return requestFull<JourneyParticipant[]>(`/v1/journeys/${encodeURIComponent(id)}/participants?${p.toString()}`);
  },
  jRetry: (id: string, pid: string) => request<{ ok: boolean }>(`/v1/journeys/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/retry`, { method: "POST" }),
  jForceExit: (id: string, pid: string) => request<{ ok: boolean }>(`/v1/journeys/${encodeURIComponent(id)}/participants/${encodeURIComponent(pid)}/force-exit`, { method: "POST" }),
  jReport: (id: string, windowDays = 7) => request<JourneyReport>(`/v1/journeys/${encodeURIComponent(id)}/report?windowDays=${windowDays}`),
  jTick: (limit = 100) => request<{ processed: number }>("/v1/journeys/tick", { method: "POST", body: JSON.stringify({ limit }) }),

  // Platform (admin): quản lý user + API key.
  listUsers: () => request<UserSummary[]>("/v1/auth/users"),

  createUser: (username: string, password: string, role: Role, name: string) =>
    request<{ id: string }>("/v1/auth/users", {
      method: "POST",
      body: JSON.stringify({ username, password, role, name }),
    }),

  setUserStatus: (id: string, status: "active" | "disabled") =>
    request<{ id: string; status: string }>(`/v1/auth/users/${encodeURIComponent(id)}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),

  updateUser: (id: string, patch: { name?: string; role?: Role; password?: string }) =>
    request<{ id: string }>(`/v1/auth/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  deleteUser: (id: string) =>
    request<{ deleted: true }>(`/v1/auth/users/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listApiKeys: () => request<ApiKeySummary[]>("/v1/auth/api-keys"),

  createApiKey: (name: string, role: Role) =>
    request<CreatedApiKey>("/v1/auth/api-keys", {
      method: "POST",
      body: JSON.stringify({ name, role }),
    }),

  revokeApiKey: (id: string) =>
    request<{ id: string; status: string }>(
      `/v1/auth/api-keys/${encodeURIComponent(id)}/revoke`,
      { method: "POST" },
    ),

  deleteApiKey: (id: string) =>
    request<{ deleted: true }>(`/v1/auth/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // ── AI Phase A ──
  getAiConfig: () => request<AiConfig>("/v1/ai/config"),
  setAiConfig: (section: AiConfigSection, value: Record<string, unknown>) =>
    request<AiConfig>("/v1/ai/config", { method: "POST", body: JSON.stringify({ section, value }) }),
  listAiConfigAudit: () => request<AiConfigAuditEntry[]>("/v1/ai/config/audit"),
  listLlmUsage: () => request<LlmUsageEntry[]>("/v1/ai/config/usage"),

  getFeature: (occId: string) => request<CustomerFeature>(`/v1/ai/features/${encodeURIComponent(occId)}`),
  recomputeFeature: (occId: string) =>
    request<CustomerFeature>("/v1/ai/features/recompute", { method: "POST", body: JSON.stringify({ occId }) }),

  getRecommendationsV2: (occId: string) =>
    request<{ occId: string; recommendations: RecommendationV2[] }>(
      `/v1/ai/recommendations/v2?occId=${encodeURIComponent(occId)}`,
    ),
  getNba: (occId: string) =>
    request<NbaDecision>("/v1/ai/nba", { method: "POST", body: JSON.stringify({ occId }) }),

  getForecast: (params: { brandId?: string; granularity?: "week" | "month"; periods?: number }) => {
    const q = new URLSearchParams();
    if (params.brandId) q.set("brandId", params.brandId);
    if (params.granularity) q.set("granularity", params.granularity);
    if (params.periods) q.set("periods", String(params.periods));
    return request<ForecastResult>(`/v1/analytics/forecast?${q.toString()}`);
  },
  getInsights: () => request<Insights>("/v1/analytics/insights"),

  assistantAsk: (question: string) =>
    request<{ text: string }>("/v1/ai/assistant/ask", { method: "POST", body: JSON.stringify({ question }) }),
  assistantSegment: (description: string) =>
    request<{ criteria: SegmentCriteria; preview: SegmentPreview }>("/v1/ai/assistant/segment", {
      method: "POST",
      body: JSON.stringify({ description }),
    }),
  assistantContent: (brief: string, brandVoice?: string, channel?: string) =>
    request<{ text: string }>("/v1/ai/assistant/content", {
      method: "POST",
      body: JSON.stringify({ brief, brandVoice, channel }),
    }),
  assistantExplain: (occId: string) =>
    request<{ text: string }>("/v1/ai/assistant/explain", { method: "POST", body: JSON.stringify({ occId }) }),

  // ── Connector & Pipeline builder ──
  getConnectorCatalog: () => request<ConnectorCatalog>("/v1/connectors/catalog"),
  createConnector: (dto: { key: string; name: string; direction: "source" | "destination"; category: string; transport: string; configSchema?: unknown[]; blurb?: string }) =>
    request<{ key: string }>("/v1/connectors", { method: "POST", body: JSON.stringify(dto) }),
  deleteConnector: (key: string) =>
    request<{ deleted: true }>(`/v1/connectors/${encodeURIComponent(key)}`, { method: "DELETE" }),
  applyConnectorTemplate: (templateKey: string) =>
    request<{ kind: "connection" | "pipeline"; id: string }>("/v1/connectors/apply-template", { method: "POST", body: JSON.stringify({ templateKey }) }),

  listConnections: () => request<Connection[]>("/v1/connections"),
  createConnection: (dto: { name: string; direction: "source" | "destination"; connectorKey: string; config?: Record<string, unknown>; status?: string }) =>
    request<Connection>("/v1/connections", { method: "POST", body: JSON.stringify(dto) }),
  setConnectionStatus: (id: string, status: string) =>
    request<{ id: string; status: string }>(`/v1/connections/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteConnection: (id: string) =>
    request<{ deleted: true }>(`/v1/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listPipelines: () => request<Pipeline[]>("/v1/pipelines"),
  getPipeline: (id: string) => request<Pipeline>(`/v1/pipelines/${encodeURIComponent(id)}`),
  createPipeline: (dto: { name: string; kind?: string; definition?: unknown }) =>
    request<Pipeline>("/v1/pipelines", { method: "POST", body: JSON.stringify(dto) }),
  savePipeline: (id: string, dto: { name?: string; kind?: string; definition?: unknown; status?: string }) =>
    request<Pipeline>(`/v1/pipelines/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(dto) }),
  setPipelineStatus: (id: string, status: string) =>
    request<{ id: string; status: string }>(`/v1/pipelines/${encodeURIComponent(id)}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deletePipeline: (id: string) =>
    request<{ deleted: true }>(`/v1/pipelines/${encodeURIComponent(id)}`, { method: "DELETE" }),

};
