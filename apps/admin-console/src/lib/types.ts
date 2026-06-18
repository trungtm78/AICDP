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

export interface LoyaltyBalance {
  available: number;
  reserved: number;
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
