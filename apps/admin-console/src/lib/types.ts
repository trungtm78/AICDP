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

export interface Customer360 {
  occId: string;
  profile: Record<string, unknown>;
  identifiers: Array<{ identifier_type: string; value_normalized: string }>;
  transactions: Array<Record<string, unknown>>;
}

export type IdentifierType =
  | "phone"
  | "email"
  | "loyalty_card"
  | "pos_member_id";

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
