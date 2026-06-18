import {
  ApiError,
  type Brand,
  type Store,
  type Product,
  type Customer360,
  type IdentifierType,
} from "./types.js";

// Client gọi core-api qua proxy /v1. Mọi data hiển thị đều lấy từ đây (không hardcode).

interface Envelope<T> {
  data: T;
}

// Rỗng (mặc định) = same-origin: dev qua Vite proxy /v1, prod cần reverse-proxy /v1 -> core-api.
// Đặt VITE_API_BASE_URL khi admin-console và core-api khác origin.
const BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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
};
