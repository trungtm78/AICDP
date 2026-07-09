// Kiểu dữ liệu khớp response core-api (services/core-api). Nguồn sự thật là API.

export interface Brand {
  brand_id: string;
  name: string;
  industry: string | null;
  brand_accent: string | null;
  status: string;
}

export interface Store {
  store_id: string;
  brand_id: string;
  name: string;
  region: string | null;
  city: string | null;
  address: string | null;
  status: string;
}

export interface Product {
  product_master_id: string;
  name: string;
  category_id: string | null;
  unit: string | null;
  status: string;
}

export interface Recommendation {
  sku: string;
  name: string | null;
  score: number;
}

export interface Customer360 {
  occId: string;
  profile: Record<string, unknown>;
  identifiers: Array<{ identifier_type: string; value_normalized: string }>;
  transactions: Array<Record<string, unknown>>;
}

export type LifecycleStage = "new" | "active" | "at_risk" | "vip" | "dormant" | "churned";

/** Một lần kích hoạt audience (Activation) — lịch sử. */
export interface ActivationRun {
  run_id: string;
  audience_name: string;
  purpose: string;
  channel: string;
  destination: string;
  total: number;
  allowed_count: number;
  suppressed_count: number;
  created_at: string;
}

// ── Connector & Pipeline builder ──
export interface ConnectorConfigField { key: string; label: string; type: "text" | "password" | "url" | "select"; placeholder?: string; secret?: boolean; options?: string[] }
export interface Connector {
  key: string; name: string; direction: "source" | "destination"; category: string;
  transport: "rest" | "webhook" | "database" | "sdk" | "warehouse" | "event-stream" | "reverse-etl" | "warehouse";
  vn?: boolean; blurb: string; configFields: ConnectorConfigField[]; isCustom?: boolean;
}
export interface ConnectorTemplate {
  key: string; name: string; blurb: string; kind: "connection" | "pipeline";
  connectorKey?: string; direction?: "source" | "destination";
  pipelineKind?: "event_stream" | "etl" | "reverse_etl"; sourceKey?: string; transform?: string; destinationKey?: string;
}
export interface ConnectorCatalog { connectors: Connector[]; templates: ConnectorTemplate[] }
export interface Connection {
  id: string; name: string; direction: "source" | "destination"; connectorKey: string; connectorName: string;
  config: Record<string, unknown>; status: "active" | "paused" | "draft" | "error"; createdAt: string;
}
export interface PipelineNode { id: string; type: "source" | "transform" | "destination"; config?: Record<string, unknown>; pos?: { x: number; y: number } }
export interface PipelineEdge { from: string; to: string }
export interface PipelineDefinition { nodes: PipelineNode[]; edges: PipelineEdge[] }
export interface Pipeline {
  id: string; name: string; kind: "event_stream" | "etl" | "reverse_etl";
  definition: PipelineDefinition; status: "active" | "paused" | "draft"; createdAt: string;
}

/** Phân tích hành vi mua chuyên sâu (Customer 360). */
export interface CustomerAnalytics {
  summary: { orderCount: number; totalSpend: number; aov: number; firstOrderAt: string | null; lastOrderAt: string | null; tenureDays: number | null };
  cadence: { avgIntervalDays: number | null; predictedNextPurchaseAt: string | null; daysUntilNext: number | null };
  predictedClv: number;
  monthlySpend: { month: string; spend: number; orders: number }[];
  brandBreakdown: { brandId: string; spend: number; orders: number; pct: number }[];
  categoryBreakdown: { categoryId: string | null; spend: number; pct: number }[];
  topStores: { storeId: string; orders: number; spend: number }[];
  dow: number[];
  paymentMix: { method: string; count: number }[];
  openCarts: {
    cartId: string;
    brandId: string;
    status: "active" | "abandoned";
    channel: string | null;
    value: number;
    itemCount: number;
    items: { sku: string; name: string; quantity: number; unit_price: number }[];
    updatedAt: string;
    ageHours: number;
  }[];
}

/** Một dòng trong danh sách khách hàng (Customer Directory). */
export interface CustomerListItem {
  occId: string;
  fullName: string | null;
  city: string | null;
  lifecycleStage: LifecycleStage | null;
  monetary: number;
  frequency: number;
  distinctBrands: number;
  lastOrderAt: string | null;
  loyaltyAvailable: number;
}

export interface LoyaltyBalance {
  available: number;
  reserved: number;
}

/** Thành viên tích điểm (leaderboard màn Loyalty). */
export interface LoyaltyMember {
  occId: string;
  fullName: string | null;
  available: number;
  totalEarned: number;
}

export interface LoyaltyResult {
  txnId: string;
  balance: LoyaltyBalance;
  idempotent: boolean;
}

export interface ReserveResult extends LoyaltyResult {
  reservationId: string;
}

export type ConsentEffectiveStatus = "granted" | "withdrawn" | "denied";

export interface ConsentState {
  purpose: string;
  status: ConsentEffectiveStatus;
  recorded_at: string | null;
}

export type ConsentPurpose =
  | "marketing_email"
  | "marketing_sms"
  | "marketing_zalo"
  | "personalization"
  | "data_sharing";

export interface ActivateResult {
  runId: string;
  total: number;
  allowedCount: number;
  suppressedCount: number;
  allowed: string[];
}

export interface SegmentCriteria {
  brandId?: string;
  minSpend?: number;
  minTransactions?: number;
}

export interface SegmentPreview {
  count: number;
  occIds: string[];
}

export interface ActivateArgs {
  audienceName: string;
  purpose: ConsentPurpose;
  channel: string;
  destination: string;
  occIds: string[];
}

export interface Overview {
  customers: number;
  transactions: number;
  revenue: number;
  loyaltyAvailable: number;
  loyaltyReserved: number;
  activationAllowed: number;
  activationSuppressed: number;
  brands: number;
  stores: number;
  products: number;
}

export type JourneyAction =
  | { type: "activation"; purpose: ConsentPurpose; channel: string; destination: string }
  | { type: "loyalty_bonus"; points: number };

export interface Journey {
  journey_id: string;
  name: string;
  segment_criteria: SegmentCriteria;
  action: JourneyAction;
  status: string;
  created_at: string;
}

export interface JourneyRunResult {
  runId: string;
  total: number;
  actionResult: Record<string, unknown>;
}

export interface CreateJourneyArgs {
  name: string;
  segmentCriteria: SegmentCriteria;
  action: JourneyAction;
}

// ── Journey engine (M1–M5): graph đa bước ──
export type JNodeType = "entry" | "wait" | "condition" | "action" | "exit";
export type JTrigger = "event" | "segment" | "manual";
export type JPredicate =
  | { kind: "lifecycle"; equals: string }
  | { kind: "churnRiskGte"; value: number }
  | { kind: "propensityGte"; value: number }
  | { kind: "loyaltyMinGte"; value: number }
  | { kind: "favoriteCategory"; equals: string }
  | { kind: "consentGranted"; purpose: string };
export type JActionCfg =
  | { kind: "activation"; purpose: string; channel: string; destination: string }
  | { kind: "loyalty_bonus"; points: number };
export interface JNode {
  id: string;
  type: JNodeType;
  config?: Record<string, unknown>;
  pos?: { x: number; y: number };
}
export interface JEdge {
  from: string;
  to: string;
  branch?: "yes" | "no";
}
export interface JourneyDefinition {
  nodes: JNode[];
  edges: JEdge[];
}
export interface JourneyRow {
  journey_id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  trigger_type: JTrigger | null;
  trigger_config: Record<string, unknown>;
  definition: JourneyDefinition | null;
  published_version: number | null;
  allow_re_enroll: boolean;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}
export interface JourneySummary extends JourneyRow {
  participants: number;
  completed: number;
}
export interface JourneyParticipant {
  id: string;
  occ_id: string;
  status: "active" | "completed" | "exited" | "failed";
  current_node_id: string | null;
  attempts: number;
  enrolled_at: string;
  completed_at: string | null;
  exit_reason: string | null;
}
export interface JourneyReport {
  entered: number;
  active: number;
  completed: number;
  exited: number;
  failed: number;
  exitReasons: { reason: string; count: number }[];
  funnel: { nodeId: string; nodeType: string; reached: number }[];
  attribution: {
    windowDays: number;
    orders: number;
    revenue: number;
    convertedCustomers: number;
    loyaltyPointsIssued: number;
    activationsAllowed: number;
    activationsSuppressed: number;
  };
  enrollmentByDay: { day: string; count: number }[];
}

export type Role =
  | "admin"
  | "data_steward"
  | "marketer"
  | "csr"
  | "analyst"
  | "compliance"
  | "executive"
  | "connector";

export interface UserSummary {
  id: string;
  username: string;
  role: Role;
  name: string;
  status: string;
  created_at: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  role: Role;
  status: string;
  created_at: string;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  role: Role;
  rawKey: string;
}

export type IdentifierType =
  | "phone"
  | "email"
  | "loyalty_card"
  | "pos_member_id";

// ── AI Phase A ──
export type LlmProvider = "anthropic" | "openai" | "gemini";
export interface LlmTaskConfig {
  provider: LlmProvider;
  model: string;
}
export interface AiConfig {
  rfm: { vipFreq: number; vipMonetary: number; atRiskGapDays: number; churnGapDays: number; dormantGapDays: number };
  reco: { topN: number; diversityWeight: number; enableCrossBrand: boolean; enableMarketBasket: boolean; boost: string[]; bury: string[] };
  forecast: { periods: number; window: number; granularity: "week" | "month" };
  decisioning: { enabled: boolean };
  features: { recoV2: boolean; nba: boolean; forecast: boolean; assistant: boolean };
  llm: {
    defaultProvider: LlmProvider;
    piiPolicy: "redact" | "block" | "allow";
    tasks: { ask: LlmTaskConfig; segment: LlmTaskConfig; content: LlmTaskConfig; explain: LlmTaskConfig };
  };
}
export type AiConfigSection = keyof AiConfig;
export interface AiConfigAuditEntry {
  id: string;
  key: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown>;
  changed_by: string;
  changed_at: string;
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
export interface CustomerFeature {
  occId: string;
  recencyDays: number | null;
  frequency: number;
  monetary: number;
  avgBasket: number;
  distinctBrands: number;
  distinctCategories: number;
  favoriteCategory: string | null;
  loyaltyAvailable: number;
  lastOrderAt: string | null;
  lifecycleStage: string | null;
  propensityScore: number | null;
  churnRisk: number | null;
  featureVersion: string;
  computedAt: string;
}
export interface RecommendationV2 {
  itemKey: string;
  productMasterId: string | null;
  name: string | null;
  brandId: string | null;
  category: string | null;
  score: number;
  source: string;
  reasons: string[];
}
export interface NbaDecision {
  occId: string;
  action: { type: string; points?: number; purpose?: string; channel?: string };
  eligible: boolean;
  reasons: string[];
  consentChecked: { purpose: string; allowed: boolean } | null;
  lifecycleStage: string | null;
}
export interface ForecastResult {
  brandId: string | null;
  storeId: string | null;
  granularity: "week" | "month";
  history: { period: string; revenue: number; transactions: number }[];
  forecast: { period: string; revenue: number }[];
  method: string;
}
export interface Insights {
  lifecycle: { stage: string; count: number }[];
  revenueByBrand: { brandId: string; revenue: number; transactions: number }[];
  topCategories: { category: string; orders: number }[];
  crossBrandCustomers: number;
  totalWithFeature: number;
  avgChurnRisk: number;
}

/** Lỗi chuẩn hóa từ error envelope của core-api. */
export class ApiError extends Error {
  readonly code: string;
  readonly fieldPath: string | null;
  readonly status: number;

  constructor(message: string, code: string, status: number, fieldPath: string | null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.fieldPath = fieldPath;
  }
}
