import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { normalizeIdentifier } from "../identity/normalize.js";

// Property thuần (không DB) cho normalize — dùng làm tập test cho mutation testing (Stryker).
describe("normalize — property thuần", () => {
  const vnNational = fc
    .tuple(fc.constantFrom("3", "5", "7", "8", "9"), fc.stringMatching(/^[0-9]{8}$/))
    .map(([h, rest]) => h + rest);

  it("PB-08: mọi biểu diễn cùng SĐT -> +84<national>; idempotent", () => {
    fc.assert(
      fc.property(vnNational, fc.array(fc.constantFrom(" ", "-", ".", "(", ")"), { maxLength: 4 }), (nat, noise) => {
        const sep = noise.join("");
        for (const f of [`0${nat}`, `+84${nat}`, `84${nat}`, `0${sep}${nat}`, ` +84 ${nat} `]) {
          const o = normalizeIdentifier("phone", f);
          expect(o).not.toBeNull();
          expect(o!.valueNormalized).toBe(`+84${nat}`);
        }
        const once = `+84${nat}`;
        expect(normalizeIdentifier("phone", once)!.valueNormalized).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  it("PB-08b: số KHÔNG hợp lệ (đầu 0/1/2/4/6, sai độ dài) -> null", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[0126]\d{8}$/), (bad) => {
        expect(normalizeIdentifier("phone", `0${bad}`)).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("PB-09: email lowercase + trim + idempotent; thiếu @ hoặc domain -> null", () => {
    const emailLike = fc
      .tuple(fc.stringMatching(/^[A-Za-z0-9]{1,8}$/), fc.stringMatching(/^[A-Za-z0-9]{1,6}$/), fc.constantFrom("com", "vn"))
      .map(([u, d, t]) => `${u}@${d}.${t}`);
    fc.assert(
      fc.property(emailLike, (email) => {
        const out = normalizeIdentifier("email", `  ${email.toUpperCase()} `);
        expect(out!.valueNormalized).toBe(email.toLowerCase());
        expect(normalizeIdentifier("email", "no-at-sign")).toBeNull();
        expect(normalizeIdentifier("email", "a@b")).toBeNull();
      }),
      { numRuns: 200 },
    );
  });

  it("PB-10: loyalty_card uppercase+trim; rỗng -> null; pos_member_id cần brandId", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]{1,10}$/), (card) => {
        expect(normalizeIdentifier("loyalty_card", ` ${card} `)!.valueNormalized).toBe(card.toUpperCase());
        expect(normalizeIdentifier("loyalty_card", "   ")).toBeNull();
        expect(normalizeIdentifier("pos_member_id", card)).toBeNull(); // thiếu brandId
        expect(normalizeIdentifier("pos_member_id", card, { brandId: "givral" })!.valueNormalized).toBe(`givral:${card}`);
      }),
      { numRuns: 150 },
    );
  });

  it("PB-10b: isStrong đúng theo loại (phone/email/loyalty_card/pos_member_id = strong)", () => {
    expect(normalizeIdentifier("phone", "0901234567")!.isStrong).toBe(true);
    expect(normalizeIdentifier("email", "a@b.com")!.isStrong).toBe(true);
    expect(normalizeIdentifier("loyalty_card", "ABC")!.isStrong).toBe(true);
    expect(normalizeIdentifier("web_anonymous_id", "anon-1")!.isStrong).toBe(false);
    expect(normalizeIdentifier("app_anonymous_id", "anon-1")!.isStrong).toBe(false);
  });
});
