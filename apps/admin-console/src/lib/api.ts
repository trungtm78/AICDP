import { getToken, clearSession } from "./auth.js";
import {
  ApiError,
  type Brand,
  type Store,
  type Product,
  type Customer360,
  type IdentifierType,
  type LoyaltyBalance,
  type LoyaltyResult,
  type ReserveResult,
  type ConsentState,
  type ConsentPurpose,
  type ActivateArgs,
  type ActivateResult,
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
} from "./types.js";

// Client gọi core-api qua proxy /v1. Mọi data hiển thị đều lấy từ đây (không hardcode).

interface Envelope<T> {
  data: T;
}

// Rỗng (mặc định) = same-origin: dev qua Vite proxy /v1, prod cần reverse-proxy /v1 -> core-api.
// Đặt VITE_API_BASE_URL khi admin-console và core-api khác origin.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  return (body as Envelope<T>).data;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ token: string; role: string; name: string }>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
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

  lookupCustomer: (type: IdentifierType, value: string) =>
    request<Customer360>(
      `/v1/customers/lookup?type=${encodeURIComponent(type)}&value=${encodeURIComponent(value)}`,
    ),

  getLoyaltyBalance: (occId: string) =>
    request<LoyaltyBalance>(`/v1/loyalty/balance?occId=${encodeURIComponent(occId)}`),

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
};
