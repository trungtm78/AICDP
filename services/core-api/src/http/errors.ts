// Error envelope chuẩn theo tracking-plan-spec mục 8 — KHÔNG nuốt data im lặng.

export type ErrorCode =
  | "SCHEMA_MISSING_REQUIRED_FIELD"
  | "SCHEMA_TYPE_MISMATCH"
  | "INVALID_IDENTIFIER"
  | "IDEMPOTENCY_CONFLICT"
  | "RATE_LIMIT_SOURCE_BURST"
  | "UNKNOWN_EVENT_TYPE"
  | "CONSENT_PURPOSE_NOT_GRANTED"
  | "CUSTOMER_NOT_FOUND"
  | "NOT_FOUND"
  | "CONSTRAINT_VIOLATION"
  | "RESET_TOKEN_INVALID"
  | "PIPELINE_INVALID"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "INVALID_AMOUNT"
  | "INSUFFICIENT_BALANCE"
  | "INSUFFICIENT_RESERVED"
  | "CURRENCY_NOT_FOUND"
  | "CONVERSION_NOT_FOUND"
  | "REWARD_NOT_FOUND"
  | "TIER_REQUIRED"
  | "OUT_OF_STOCK"
  | "VOUCHER_NOT_FOUND"
  | "VOUCHER_INVALID_STATE"
  | "VOUCHER_BRAND_MISMATCH"
  | "RESERVATION_NOT_FOUND"
  | "RESERVATION_INVALID_STATE"
  | "LLM_DISABLED"
  | "LLM_NOT_CONFIGURED"
  | "JOURNEY_NOT_FOUND"
  | "JOURNEY_NOT_EDITABLE"
  | "JOURNEY_INVALID"
  | "JOURNEY_NOT_PUBLISHED"
  | "JOURNEY_USE_ENROLL"
  | "CONNECTOR_URL_BLOCKED"
  | "CONNECTOR_UNAUTHORIZED"
  | "CONNECTOR_MISCONFIGURED"
  | "CONNECTOR_RATE_LIMIT"
  | "CONNECTOR_PULL_BUSY"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "IPN_CHECKSUM_INVALID"
  | "SECRET_DECRYPT_FAILED"
  | "EGRESS_NOT_ALLOWED"
  | "INTEGRATION_NOT_AVAILABLE"
  | "INTERNAL";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    why: string;
    fix: string;
    field_path: string | null;
    schema_version: number;
    docs_url: string | null;
    correlation_id: string;
    retryable: boolean;
    quarantine_id: string | null;
  };
}

const DOCS_BASE = "https://docs.occ-cdp.internal/tracking-plan-spec";

export interface AppErrorInit {
  code: ErrorCode;
  httpStatus: number;
  message: string;
  why?: string;
  fix?: string;
  fieldPath?: string | null;
  retryable?: boolean;
  quarantineId?: string | null;
  docsAnchor?: string;
}

/** Lỗi nghiệp vụ/validation chuẩn hóa — filter sẽ render thành ErrorEnvelope. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly why: string;
  readonly fix: string;
  readonly fieldPath: string | null;
  readonly retryable: boolean;
  readonly quarantineId: string | null;
  readonly docsAnchor: string | undefined;

  constructor(init: AppErrorInit) {
    super(init.message);
    this.name = "AppError";
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.why = init.why ?? "";
    this.fix = init.fix ?? "";
    this.fieldPath = init.fieldPath ?? null;
    this.retryable = init.retryable ?? false;
    this.quarantineId = init.quarantineId ?? null;
    this.docsAnchor = init.docsAnchor;
  }
}

export function buildEnvelope(
  err: AppError,
  correlationId: string,
  schemaVersion = 1,
): ErrorEnvelope {
  return {
    error: {
      code: err.code,
      message: err.message,
      why: err.why,
      fix: err.fix,
      field_path: err.fieldPath,
      schema_version: schemaVersion,
      docs_url: err.docsAnchor ? `${DOCS_BASE}#${err.docsAnchor}` : null,
      correlation_id: correlationId,
      retryable: err.retryable,
      quarantine_id: err.quarantineId,
    },
  };
}
