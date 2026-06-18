import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fc from "fast-check";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { normalizeIdentifier } from "../identity/normalize.js";
import { resolveOccId } from "../identity/identity.repo.js";
import { earn, reserve, capture, release, getBalance, LoyaltyError } from "../loyalty/loyalty.service.js";
import { recordConsent, isAllowed } from "../consent/consent.service.js";
import { activate } from "../activation/activation.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// TẦNG CHUYÊN GIA — property-based + model-based + metamorphic (fast-check) trên
// Postgres thật. Chứng minh BẤT BIẾN trên cả miền input, không vài ví dụ tay.
// ─────────────────────────────────────────────────────────────────────────────

let kc = 0;
const key = () => `pb-${Date.now()}-${kc++}`;

async function freshOcc(): Promise<string> {
  const r = await pool.query<{ occ_id: string }>("INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id");
  return r.rows[0]!.occ_id;
}

async function txnSumsZero(): Promise<boolean> {
  const r = await pool.query<{ bad: number }>(
    `SELECT count(*)::int AS bad FROM (SELECT txn_id, sum(delta) AS s FROM cdp.loyalty_entry GROUP BY txn_id) t WHERE s <> 0`,
  );
  return Number(r.rows[0]!.bad) === 0;
}

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

// ═══ NORMALIZE — hàm thuần, numRuns cao ═══
describe("Identity normalize — property (pure)", () => {
  // Sinh 9 số quốc gia VN hợp lệ: chữ đầu ∈ {3,5,7,8,9}, 8 chữ số còn lại bất kỳ.
  const vnNational = fc
    .tuple(fc.constantFrom("3", "5", "7", "8", "9"), fc.stringMatching(/^[0-9]{8}$/))
    .map(([h, rest]) => h + rest);

  it("PB-08: mọi biểu diễn cùng SĐT (0.., +84.., 84.., có space/dấu) -> cùng +84<national>", () => {
    fc.assert(
      fc.property(vnNational, fc.array(fc.constantFrom(" ", "-", ".", "(", ")"), { maxLength: 4 }), (nat, noise) => {
        const sep = noise.join("");
        const forms = [`0${nat}`, `+84${nat}`, `84${nat}`, `0${sep}${nat}`, ` +84 ${nat} `];
        const outs = forms.map((f) => normalizeIdentifier("phone", f));
        for (const o of outs) {
          expect(o).not.toBeNull();
          expect(o!.valueNormalized).toBe(`+84${nat}`);
        }
        // idempotent: chuẩn hóa lần 2 không đổi
        const once = outs[0]!.valueNormalized;
        expect(normalizeIdentifier("phone", once)!.valueNormalized).toBe(once);
      }),
      { numRuns: 300 },
    );
  });

  it("PB-09: email -> lowercase + trim, idempotent", () => {
    const emailLike = fc
      .tuple(fc.stringMatching(/^[A-Za-z0-9]{1,8}$/), fc.stringMatching(/^[A-Za-z0-9]{1,6}$/), fc.constantFrom("com", "vn", "net"))
      .map(([u, d, t]) => `${u}@${d}.${t}`);
    fc.assert(
      fc.property(emailLike, fc.array(fc.constantFrom(" ", "\t"), { maxLength: 3 }), (email, pad) => {
        const p = pad.join("");
        const out = normalizeIdentifier("email", `${p}${email.toUpperCase()}${p}`);
        expect(out).not.toBeNull();
        expect(out!.valueNormalized).toBe(email.toLowerCase());
        expect(normalizeIdentifier("email", out!.valueNormalized)!.valueNormalized).toBe(out!.valueNormalized);
      }),
      { numRuns: 300 },
    );
  });

  it("PB-10: normalize KHÔNG bao giờ ném exception trên chuỗi bất kỳ (trả object|null)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("phone", "email", "loyalty_card", "web_anonymous_id", "app_anonymous_id"),
        fc.string(),
        (type, value) => {
          const out = normalizeIdentifier(type as any, value);
          expect(out === null || typeof out.valueNormalized === "string").toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

// ═══ LOYALTY — property + model-based trên DB ═══
describe("Loyalty — property + model-based (DB)", () => {
  it("PB-01: n earn (points>0, key khác nhau) -> available = Σpoints, reserved = 0", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 100000 }), { minLength: 1, maxLength: 8 }), async (pts) => {
        const occId = await freshOcc();
        for (const p of pts) await earn(pool, { occId, points: p, idempotencyKey: key() });
        const bal = await getBalance(pool, occId);
        expect(bal.available).toBe(pts.reduce((a, b) => a + b, 0));
        expect(bal.reserved).toBe(0);
      }),
      { numRuns: 25 },
    );
  });

  it("PB-04: earn idempotent — cùng key + cùng points lặp k lần -> chỉ +points 1 lần", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 100000 }), fc.integer({ min: 2, max: 5 }), async (p, k) => {
        const occId = await freshOcc();
        const ik = key();
        for (let i = 0; i < k; i++) await earn(pool, { occId, points: p, idempotencyKey: ik });
        expect((await getBalance(pool, occId)).available).toBe(p);
      }),
      { numRuns: 20 },
    );
  });

  it("PB-05: earn cùng key + points KHÁC -> IDEMPOTENCY_CONFLICT, không ghi", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), fc.integer({ min: 1, max: 50000 }), async (p1, p2) => {
        fc.pre(p1 !== p2);
        const occId = await freshOcc();
        const ik = key();
        await earn(pool, { occId, points: p1, idempotencyKey: ik });
        let threw = false;
        try {
          await earn(pool, { occId, points: p2, idempotencyKey: ik });
        } catch (e) {
          threw = true;
          expect((e as LoyaltyError).code).toBe("IDEMPOTENCY_CONFLICT");
        }
        expect(threw).toBe(true);
        expect((await getBalance(pool, occId)).available).toBe(p1);
      }),
      { numRuns: 20 },
    );
  });

  it("PB-06/SF-02: chuỗi lệnh ngẫu nhiên — model khớp + KHÔNG ÂM + Σdelta=0", async () => {
    const action = fc.record({
      kind: fc.constantFrom("earn", "reserve", "capture", "release"),
      p: fc.integer({ min: 1, max: 1000 }),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 1, maxLength: 14 }), async (actions) => {
        const occId = await freshOcc();
        let eAvail = 0,
          eRes = 0;
        const held: { id: string; p: number }[] = [];
        for (const a of actions) {
          if (a.kind === "earn") {
            await earn(pool, { occId, points: a.p, idempotencyKey: key() });
            eAvail += a.p;
          } else if (a.kind === "reserve") {
            if (a.p <= eAvail) {
              const r = await reserve(pool, { occId, points: a.p, idempotencyKey: key() });
              eAvail -= a.p;
              eRes += a.p;
              held.push({ id: r.reservationId, p: a.p });
            } else {
              let threw = false;
              try {
                await reserve(pool, { occId, points: a.p, idempotencyKey: key() });
              } catch (e) {
                threw = true;
                expect((e as LoyaltyError).code).toBe("INSUFFICIENT_BALANCE");
              }
              expect(threw).toBe(true);
            }
          } else if (a.kind === "capture") {
            const h = held.shift();
            if (h) {
              await capture(pool, { reservationId: h.id, idempotencyKey: key() });
              eRes -= h.p;
            }
          } else {
            const h = held.shift();
            if (h) {
              await release(pool, { reservationId: h.id, idempotencyKey: key() });
              eRes -= h.p;
              eAvail += h.p;
            }
          }
          const bal = await getBalance(pool, occId);
          expect(bal.available).toBe(eAvail);
          expect(bal.reserved).toBe(eRes);
          expect(bal.available).toBeGreaterThanOrEqual(0);
          expect(bal.reserved).toBeGreaterThanOrEqual(0);
        }
        expect(await txnSumsZero()).toBe(true);
      }),
      { numRuns: 15 },
    );
  });

  it("MR-07: reserve(R) rồi release == không đổi available (đảo nghịch)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50000 }), async (r) => {
        const occId = await freshOcc();
        await earn(pool, { occId, points: r, idempotencyKey: key() });
        const before = await getBalance(pool, occId);
        const res = await reserve(pool, { occId, points: r, idempotencyKey: key() });
        await release(pool, { reservationId: res.reservationId, idempotencyKey: key() });
        const after = await getBalance(pool, occId);
        expect(after.available).toBe(before.available);
        expect(after.reserved).toBe(before.reserved);
      }),
      { numRuns: 20 },
    );
  });

  it("SF-01: state machine — capture rồi capture lại -> RESERVATION_INVALID_STATE; release sau capture -> chặn", async () => {
    const occId = await freshOcc();
    await earn(pool, { occId, points: 100, idempotencyKey: key() });
    const res = await reserve(pool, { occId, points: 30, idempotencyKey: key() });
    await capture(pool, { reservationId: res.reservationId, idempotencyKey: key() });
    await expect(capture(pool, { reservationId: res.reservationId, idempotencyKey: key() })).rejects.toMatchObject({
      code: "RESERVATION_INVALID_STATE",
    });
    await expect(release(pool, { reservationId: res.reservationId, idempotencyKey: key() })).rejects.toMatchObject({
      code: "RESERVATION_INVALID_STATE",
    });
  });
});

// ═══ IDENTITY resolve — property + metamorphic (DB) ═══
describe("Identity resolve — property (DB)", () => {
  const vnPhone = fc
    .tuple(fc.constantFrom("3", "5", "7", "8", "9"), fc.stringMatching(/^[0-9]{8}$/))
    .map(([h, r]) => `0${h}${r}`);

  it("PB-11: cùng identifier -> luôn cùng occId (resolve theo trạng thái, deterministic)", async () => {
    await fc.assert(
      fc.asyncProperty(vnPhone, async (phone) => {
        const a = await resolveOccId(pool, [{ type: "phone", value: phone }]);
        const b = await resolveOccId(pool, [{ type: "phone", value: phone }]);
        expect(a).not.toBeNull();
        expect(a).toBe(b);
      }),
      { numRuns: 20 },
    );
  });

  it("MR-06: hoán vị thứ tự identifier (phone+email) -> cùng occId", async () => {
    await fc.assert(
      fc.asyncProperty(vnPhone, async (phone) => {
        const email = `u${kc}@test.com`;
        const a = await resolveOccId(pool, [
          { type: "phone", value: phone },
          { type: "email", value: email },
        ]);
        const b = await resolveOccId(pool, [
          { type: "email", value: email },
          { type: "phone", value: phone },
        ]);
        expect(a).toBe(b);
      }),
      { numRuns: 15 },
    );
  });
});

// ═══ CONSENT — property (DB) ═══
describe("Consent — property (DB)", () => {
  const purpose = fc.constantFrom("marketing_email", "marketing_sms", "marketing_zalo", "personalization", "data_sharing");

  it("PB-14: occ chưa ghi consent -> isAllowed = false (deny-by-default)", async () => {
    await fc.assert(
      fc.asyncProperty(purpose, async (p) => {
        const occId = await freshOcc();
        expect(await isAllowed(pool, occId, p)).toBe(false);
      }),
      { numRuns: 20 },
    );
  });

  it("PB-15: latest-wins — chuỗi granted/withdrawn -> isAllowed == (bản cuối == granted)", async () => {
    const ev = fc.constantFrom<"granted" | "withdrawn">("granted", "withdrawn");
    await fc.assert(
      fc.asyncProperty(purpose, fc.array(ev, { minLength: 1, maxLength: 6 }), async (p, events) => {
        const occId = await freshOcc();
        for (const status of events) await recordConsent(pool, { occId, purpose: p, status, source: "csr" });
        const expected = events[events.length - 1] === "granted";
        expect(await isAllowed(pool, occId, p)).toBe(expected);
      }),
      { numRuns: 20 },
    );
  });
});

// ═══ ACTIVATION — property/metamorphic (DB) ═══
describe("Activation — property (DB)", () => {
  it("PB-13: total = allowedCount + suppressedCount; allowed ⊆ input; chỉ occ granted được gửi", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (grantFlags) => {
        const purpose = "marketing_email";
        const occIds: string[] = [];
        let expectedAllowed = 0;
        for (const grant of grantFlags) {
          const occId = await freshOcc();
          occIds.push(occId);
          if (grant) {
            await recordConsent(pool, { occId, purpose, status: "granted", source: "csr" });
            expectedAllowed++;
          }
        }
        const r = await activate(pool, {
          audienceName: `aud-${kc}`,
          purpose,
          channel: "email",
          destination: "rudderstack",
          occIds,
        });
        expect(r.total).toBe(occIds.length);
        expect(r.allowedCount + r.suppressedCount).toBe(r.total);
        expect(r.allowedCount).toBe(expectedAllowed);
        expect(r.allowed.every((id) => occIds.includes(id))).toBe(true);
      }),
      { numRuns: 15 },
    );
  });
});
