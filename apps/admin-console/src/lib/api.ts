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
} from "./types.js";

// Client gọi core-api qua proxy /v1. Mọi data hiển thị đều lấy từ đây (không hardcode).

interface Envelope<T> {
  data: T;
}

// Rỗng (mặc định) = same-origin: dev qua Vite proxy /v1, prod cần reverse-proxy /v1 -> core-api.
// Đặt VITE_API_BASE_URL khi admin-console và core-api khác origin.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
// DEV: dùng key admin seed sẵn để UI hoạt động. PROD: thay bằng login/JWT (KHÔNG nhúng
// key admin vào bundle SPA — xem memory occ-cdp-auth-gap).
const API_KEY = import.meta.env.VITE_API_KEY ?? "occ-dev-admin-key-2026";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error ?? {};
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
};
