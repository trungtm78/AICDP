import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validate } from "../http/validate.js";
import { AppError } from "../http/errors.js";
import {
  orderCompletedSchema,
  identifySchema,
  loyaltyEarnSchema,
  activationSchema,
  consentRecordSchema,
} from "../http/schemas.js";

// ─────────────────────────────────────────────────────────────────────────────
// TẦNG CHUYÊN GIA — FUZZING biên parse (validate + zod schemas).
// Bất biến: với input BẤT KỲ, validate() hoặc trả data hợp lệ, hoặc ném AppError
// CÓ KIỂM SOÁT (code SCHEMA_*) — KHÔNG bao giờ rò ZodError/TypeError/crash.
// ─────────────────────────────────────────────────────────────────────────────

const CONTROLLED = new Set(["SCHEMA_MISSING_REQUIRED_FIELD", "SCHEMA_TYPE_MISMATCH"]);

function assertControlled(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    // Chỉ chấp nhận AppError với code SCHEMA_* (không rò ZodError/TypeError).
    expect(e).toBeInstanceOf(AppError);
    expect(CONTROLLED.has((e as { code: string }).code)).toBe(true);
  }
}

describe("FZ-01: fuzz validate() với JSON tùy ý -> không crash, lỗi có kiểm soát", () => {
  const schemas = [
    { name: "orderCompleted", s: orderCompletedSchema },
    { name: "identify", s: identifySchema },
    { name: "loyaltyEarn", s: loyaltyEarnSchema },
    { name: "activation", s: activationSchema },
    { name: "consentRecord", s: consentRecordSchema },
  ];

  for (const { name, s } of schemas) {
    it(`FZ-01.${name}: input bất kỳ (anything) -> AppError SCHEMA_* hoặc hợp lệ`, () => {
      fc.assert(
        fc.property(fc.anything(), (data) => {
          assertControlled(() => validate(s as any, data));
        }),
        { numRuns: 500 },
      );
    });
  }

  it("FZ-04: order_completed gần-hợp-lệ nhưng total méo (NaN/Infinity/chuỗi/âm/khổng lồ) -> kiểm soát", () => {
    const weirdNum = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
      fc.constant(1e309),
      fc.double({ min: -1e6, max: -1 }),
      fc.string(),
      fc.constant(null),
    );
    fc.assert(
      fc.property(weirdNum, (total) => {
        const payload = {
          type: "order_completed",
          brand_id: "givral",
          store_id: "s1",
          source: "pos",
          occ_timestamp: "2026-06-18T10:00:00+07:00",
          identifiers: [{ type: "phone", value: "0901234567" }],
          properties: { pos_transaction_id: "T", total },
        };
        // Hoặc parse được (nếu total tình cờ hợp lệ), hoặc AppError SCHEMA_* — không crash.
        assertControlled(() => validate(orderCompletedSchema as any, payload));
      }),
      { numRuns: 300 },
    );
  });

  it("FZ-03: occ_timestamp méo (thiếu offset, ngày vô lý, chuỗi rác) -> kiểm soát", () => {
    const badTs = fc.oneof(
      fc.constant("2026-06-18 10:30"),
      fc.constant("0000-00-00"),
      fc.constant("not-a-date"),
      fc.string(),
      fc.integer(),
    );
    fc.assert(
      fc.property(badTs, (ts) => {
        const payload = {
          type: "order_completed",
          brand_id: "givral",
          store_id: "s1",
          source: "pos",
          occ_timestamp: ts,
          identifiers: [{ type: "phone", value: "0901234567" }],
          properties: { pos_transaction_id: "T", total: 1000 },
        };
        assertControlled(() => validate(orderCompletedSchema as any, payload));
      }),
      { numRuns: 200 },
    );
  });
});
