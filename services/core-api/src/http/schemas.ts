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

export const lifecycleStageEnum = z.enum([
  "new",
  "active",
  "at_risk",
  "vip",
  "dormant",
  "churned",
]);

export const segmentPreviewSchema = z.object({
  brandId: z.string().min(1).optional(),
  minSpend: z.number().int().nonnegative().safe().optional(),
  minTransactions: z.number().int().positive().safe().optional(),
  // Mở rộng AI Phase A (tiêu chí từ customer_feature) — tương thích ngược (đều optional).
  maxRecencyDays: z.number().int().nonnegative().safe().optional(),
  lifecycleStage: lifecycleStageEnum.optional(),
  loyaltyMin: z.number().int().nonnegative().safe().optional(),
  categoryAffinity: z.string().min(1).optional(),
  consentPurpose: consentPurposeEnum.optional(),
  // Tiêu chí dự đoán (customer_prediction)
  churnProbGte: z.number().min(0).max(1).optional(),
  propensityGte: z.number().min(0).max(1).optional(),
  clvMin: z.number().int().nonnegative().safe().optional(),
});

export const lookalikeSchema = z.object({
  seedOccIds: z.array(z.string().uuid()).min(1).max(500),
  limit: z.number().int().positive().max(200).optional(),
});

export const offerCreateSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["loyalty_bonus", "discount", "content", "activation"]),
  purpose: z.string().min(1).optional(),
  channel: z.string().min(1).optional(),
  baseValue: z.number().int().nonnegative().safe(),
  eligibility: z.string().min(1).optional(),
});

export const experimentCreateSchema = z.object({
  name: z.string().min(1).max(120),
  holdoutPct: z.number().int().min(0).max(100).optional(),
});

export const forecastQuerySchema = z.object({
  brandId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  granularity: z.enum(["week", "month"]).optional(),
  periods: z.coerce.number().int().positive().max(52).optional(),
  window: z.coerce.number().int().positive().max(52).optional(),
});

export const journeyCreateSchema = z.object({
  name: z.string().min(1).max(200),
  segmentCriteria: segmentPreviewSchema.default({}),
  action: z.discriminatedUnion("type", [
    z.object({
      type: z.literal("activation"),
      purpose: consentPurposeEnum,
      channel: z.string().min(1).max(50),
      destination: z.string().min(1).max(100),
    }),
    z.object({
      type: z.literal("loyalty_bonus"),
      points: z.number().int().positive().safe(),
    }),
  ]),
});

export const activationSchema = z.object({
  audienceName: z.string().min(1).max(200),
  purpose: consentPurposeEnum, // chỉ kích hoạt theo mục đích có trong danh mục consent
  channel: z.string().min(1).max(50),
  destination: z.string().min(1).max(100),
  occIds: z.array(z.string().uuid()).max(100000),
});

// Giao hàng activation run tới 1 destination connection (Phase 4 wiring OUTBOUND).
export const activationDeliverSchema = z.object({
  connectionId: z.string().uuid(),
});

export const consentListQuerySchema = z.object({
  occId: z.string().uuid(),
});

export const consentCheckQuerySchema = z.object({
  occId: z.string().uuid(),
  purpose: consentPurposeEnum,
});

export const aiRecQuerySchema = z.object({
  occId: z.string().uuid(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export const aiConfigSectionEnum = z.enum([
  "rfm",
  "reco",
  "forecast",
  "decisioning",
  "ml",
  "features",
  "llm",
]);

export const aiConfigUpdateSchema = z.object({
  section: aiConfigSectionEnum,
  value: z.record(z.unknown()),
});

export const nbaSchema = z.object({
  occId: z.string().uuid(),
});

export const featureRecomputeSchema = z.object({
  occId: z.string().uuid().optional(), // có occId -> 1 khách; không -> batch toàn bộ
});

export const assistantAskSchema = z.object({ question: z.string().min(1).max(1000) });
export const assistantSegmentSchema = z.object({ description: z.string().min(1).max(1000) });
export const assistantContentSchema = z.object({
  brief: z.string().min(1).max(2000),
  brandVoice: z.string().min(1).max(200).optional(),
  channel: z.string().min(1).max(50).optional(),
});
export const assistantExplainSchema = z.object({ occId: z.string().uuid() });

export const roleEnum = z.enum([
  "admin",
  "data_steward",
  "marketer",
  "csr",
  "analyst",
  "compliance",
  "executive",
  "connector",
]);

export const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

export const passwordResetRequestSchema = z.object({
  username: z.string().min(1).max(100),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(10).max(200),
  newPassword: z.string().min(8).max(200),
});

export const createUserSchema = z.object({
  username: z.string().min(3).max(100),
  password: z.string().min(8).max(200),
  role: roleEnum,
  name: z.string().min(1).max(200),
});

export const userStatusSchema = z.object({
  status: z.enum(["active", "disabled"]),
});

export const apiKeyCreateSchema = z.object({
  name: z.string().min(1).max(100),
  role: roleEnum,
});

export const lookupQuerySchema = z.object({
  type: identifierSchema.shape.type,
  value: z.string().min(1),
  brand_id: z.string().optional(),
});

// Query cho Customer Directory (list). Query param là chuỗi -> coerce số cho limit/offset.
export const customerListQuerySchema = z.object({
  search: z.string().optional(),
  lifecycle: lifecycleStageEnum.optional(),
  brand: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// Ít nhất một trường phải có mặt khi cập nhật (tránh UPDATE rỗng).
const hasAtLeastOneField = (o: Record<string, unknown>): boolean =>
  Object.values(o).some((v) => v !== undefined);

export const storeUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    brand_id: z.string().min(1).optional(),
    region: z.string().optional(),
    city: z.string().optional(),
    address: z.string().optional(),
  })
  .refine(hasAtLeastOneField, { message: "Cần ít nhất một trường để cập nhật" });

export const productUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    category_id: z.string().optional(),
    unit: z.string().optional(),
  })
  .refine(hasAtLeastOneField, { message: "Cần ít nhất một trường để cập nhật" });

export const brandCreateSchema = z.object({
  brand_id: z.string().min(1),
  name: z.string().min(1),
  industry: z.string().optional(),
  brand_accent: z.string().optional(),
});

export const brandUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    industry: z.string().optional(),
    brand_accent: z.string().optional(),
  })
  .refine(hasAtLeastOneField, { message: "Cần ít nhất một trường để cập nhật" });

export const userUpdateSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    role: roleEnum.optional(),
    password: z.string().min(8).max(200).optional(),
  })
  .refine(hasAtLeastOneField, {
    message: "Cần ít nhất một trường (name/role/password)",
  });

// ── Journey engine (M1) ──
const journeyNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["entry", "wait", "condition", "action", "exit"]),
  config: z.record(z.unknown()).optional(),
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
});
const journeyEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  branch: z.enum(["yes", "no"]).optional(),
});
export const journeyDefinitionSchema = z.object({
  nodes: z.array(journeyNodeSchema).min(1).max(200),
  edges: z.array(journeyEdgeSchema).max(400),
});
export const journeyDraftSchema = z.object({
  name: z.string().min(1).max(200),
  triggerType: z.enum(["event", "segment", "manual"]).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  definition: journeyDefinitionSchema.optional(),
});
export const journeySaveSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  triggerType: z.enum(["event", "segment", "manual"]).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  definition: journeyDefinitionSchema.optional(),
});
export const journeyEnrollSchema = z.object({
  occIds: z.array(z.string().uuid()).max(10000).optional(),
  useSegment: z.boolean().optional(),
});

// Connector & Pipeline builder
const connectorKeyRe = z.string().min(1).max(80);
export const connectionCreateSchema = z.object({
  name: z.string().min(1).max(120),
  direction: z.enum(["source", "destination"]),
  connectorKey: connectorKeyRe,
  config: z.record(z.unknown()).optional(),
  status: z.enum(["active", "paused", "draft", "error"]).optional(),
});
export const connectionStatusSchema = z.object({
  status: z.enum(["active", "paused", "draft", "error"]),
});
export const connectorCreateSchema = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/i),
  name: z.string().min(1).max(120),
  direction: z.enum(["source", "destination"]),
  category: z.string().min(1).max(80),
  transport: z.enum(["rest", "webhook", "database", "sdk", "warehouse"]),
  configSchema: z.array(z.record(z.unknown())).optional(),
  blurb: z.string().max(300).optional(),
});
const pipeNode = z.object({
  id: z.string().min(1),
  type: z.enum(["source", "transform", "destination"]),
  config: z.record(z.unknown()).optional(),
  pos: z.object({ x: z.number(), y: z.number() }).optional(),
});
const pipeDef = z.object({
  nodes: z.array(pipeNode),
  edges: z.array(z.object({ from: z.string(), to: z.string() })),
});
export const pipelineCreateSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(["event_stream", "etl", "reverse_etl"]).optional(),
  definition: pipeDef.optional(),
});
export const pipelineSaveSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.enum(["event_stream", "etl", "reverse_etl"]).optional(),
  definition: pipeDef.optional(),
  status: z.enum(["active", "paused", "draft"]).optional(),
});
export const pipelineStatusSchema = z.object({ status: z.enum(["active", "paused", "draft"]) });
export const applyTemplateSchema = z.object({ templateKey: z.string().min(1).max(80) });
// Test-send OUTBOUND: gửi thử 1 message qua destination connection (payload/recipient tuỳ chọn).
export const testSendSchema = z.object({
  channel: z.string().min(1).max(50).optional(),
  recipient: z.string().min(1).max(500).optional(),
  payload: z.record(z.unknown()).optional(),
});

// ── Phase 2: INBOUND webhook (payload webhook-native; brand_id LẤY TỪ connection, KHÔNG từ payload) ──
// .strict(): field lạ (vd brand_id spoof) -> 400 fail-closed, không âm thầm bỏ qua (kể cả trong identifiers).
const inboundIdentifierSchema = identifierSchema.strict();
export const inboundOrderSchema = z
  .object({
    type: z.literal("order_completed"),
    // store_id KHÔNG chứa ':' (delimiter message_id {brand}:{store}:{txn}) hay ký tự điều khiển ->
    // chống trùng khoá idempotency/nuốt giao dịch âm thầm (review Phase 3).
    store_id: z.string().min(1).max(120).regex(/^[^:]+$/, "store_id không hợp lệ (cấm ':' và ký tự điều khiển)"),
    source: z.string().min(1).max(80).optional(),
    occ_timestamp: z.string().datetime({ offset: true }).optional(),
    identifiers: z.array(inboundIdentifierSchema).max(20).optional(),
    properties: z
      .object({
        pos_transaction_id: z.string().min(1).max(200),
        currency: z.string().max(10).optional(),
        total: z.number().finite(),
        payment_method: z.string().max(60).optional(),
        business_date: z.string().date().optional(),
        items: z.array(z.unknown()).max(500).optional(),
      })
      .strict(),
  })
  .strict();

export const inboundIdentifySchema = z
  .object({
    type: z.literal("identify"),
    identifiers: z.array(inboundIdentifierSchema).min(1).max(20),
    traits: z
      .object({
        full_name: z.string().max(200).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().max(200).optional(),
        birth_date: z.string().date().optional(),
        gender: z.string().max(20).optional(),
        city: z.string().max(120).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// Payload write-key shape Segment/RudderStack (track/identify). Không strict (SDK gửi nhiều field
// meta context/integrations); chỉ rút field cần. brand_id vẫn từ connection.
export const segmentTrackSchema = z.object({
  type: z.literal("track"),
  event: z.string().min(1).max(200),
  userId: z.string().max(200).optional(),
  anonymousId: z.string().max(200).optional(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  properties: z.record(z.unknown()).optional(),
});
export const segmentIdentifySchema = z.object({
  type: z.literal("identify"),
  userId: z.string().max(200).optional(),
  anonymousId: z.string().max(200).optional(),
  traits: z.record(z.unknown()).optional(),
});
