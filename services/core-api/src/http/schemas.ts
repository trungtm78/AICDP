import { z } from "zod";

// Zod schemas cho request body — source of truth validation tầng HTTP.

export const identifierSchema = z.object({
  type: z.enum([
    "phone",
    "email",
    "loyalty_card",
    "pos_member_id",
    "web_anonymous_id",
    "app_anonymous_id",
    "social_lead_id",
  ]),
  value: z.string().min(1),
});

export const storeCreateSchema = z.object({
  store_id: z.string().min(1),
  brand_id: z.string().min(1),
  name: z.string().min(1),
  region: z.string().optional(),
  city: z.string().optional(),
  address: z.string().optional(),
});

export const categoryCreateSchema = z.object({
  category_id: z.string().min(1),
  name: z.string().min(1),
  parent_id: z.string().optional(),
});

export const productCreateSchema = z.object({
  product_master_id: z.string().min(1),
  name: z.string().min(1),
  category_id: z.string().optional(),
  unit: z.string().optional(),
});

export const skuMappingSchema = z.object({
  brand_id: z.string().min(1),
  pos_sku: z.string().min(1),
  product_master_id: z.string().min(1),
});

export const orderCompletedSchema = z.object({
  type: z.literal("order_completed"),
  brand_id: z.string().min(1),
  store_id: z.string().min(1),
  source: z.string().min(1),
  // ISO 8601 (chấp nhận Z hoặc offset) -> khớp timestamptz, chặn lỗi pg 500.
  occ_timestamp: z.string().datetime({ offset: true }),
  identifiers: z.array(identifierSchema).optional(),
  properties: z.object({
    pos_transaction_id: z.string().min(1),
    currency: z.string().optional(),
    total: z.number().finite(),
    payment_method: z.string().optional(),
    business_date: z.string().date().optional(), // YYYY-MM-DD khớp cột date
    items: z.array(z.unknown()).optional(),
  }),
});

export const identifySchema = z.object({
  type: z.literal("identify"),
  brand_id: z.string().min(1),
  identifiers: z.array(identifierSchema).min(1),
  traits: z
    .object({
      full_name: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      birth_date: z.string().date().optional(), // YYYY-MM-DD khớp cột date
      gender: z.string().optional(),
      city: z.string().optional(),
    })
    .optional(),
});

// points: số nguyên trong khoảng an toàn (chống precision-loss bigint); dấu/biên trị
// nghiệp vụ do service quyết (trả INVALID_AMOUNT) để giữ mã lỗi nhất quán.
const pointsSchema = z.number().int().safe();

export const loyaltyEarnSchema = z.object({
  occId: z.string().uuid(),
  points: pointsSchema,
  idempotencyKey: z.string().min(1),
  reason: z.string().optional(),
});

export const loyaltyReserveSchema = z.object({
  occId: z.string().uuid(),
  points: pointsSchema,
  idempotencyKey: z.string().min(1),
});

export const loyaltyReservationOpSchema = z.object({
  reservationId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
});

export const loyaltyBalanceQuerySchema = z.object({
  occId: z.string().uuid(),
});

// Purpose v1 (chốt danh mục để tránh ghi consent mục đích tùy tiện).
export const consentPurposeEnum = z.enum([
  "marketing_email",
  "marketing_sms",
  "marketing_zalo",
  "personalization",
  "data_sharing",
]);

export const consentRecordSchema = z.object({
  occId: z.string().uuid(),
  purpose: consentPurposeEnum,
  status: z.enum(["granted", "withdrawn"]),
  source: z.enum(["pos", "web", "csr", "import", "api"]),
  channel: z.string().max(100).optional(),
  evidence: z.string().max(2000).optional(),
});

export const activationSchema = z.object({
  audienceName: z.string().min(1).max(200),
  purpose: consentPurposeEnum, // chỉ kích hoạt theo mục đích có trong danh mục consent
  channel: z.string().min(1).max(50),
  destination: z.string().min(1).max(100),
  occIds: z.array(z.string().uuid()).max(100000),
});

export const consentListQuerySchema = z.object({
  occId: z.string().uuid(),
});

export const consentCheckQuerySchema = z.object({
  occId: z.string().uuid(),
  purpose: consentPurposeEnum,
});

export const lookupQuerySchema = z.object({
  type: identifierSchema.shape.type,
  value: z.string().min(1),
  brand_id: z.string().optional(),
});
