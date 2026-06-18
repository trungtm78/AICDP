import { describe, it, expect, beforeAll } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted, getCustomer360 } from "../ingestion/ingestion.service.js";
import { previewSegment } from "../segment/segment.service.js";
import { getBalance, earn } from "../loyalty/loyalty.service.js";

// ─────────────────────────────────────────────────────────────────────────────
// TẦNG CHUYÊN GIA — PERFORMANCE ở quy mô (PF-04/05/06). Seed dataset lớn rồi đo
// độ trễ thao tác chính (mức user-perceivable). Không phải load-test chuyên sâu.
// ─────────────────────────────────────────────────────────────────────────────

const N = 400; // số khách seed
const phones: string[] = [];
let occSample: string;

function phoneOf(i: number): string {
  return `09${String(i).padStart(8, "0")}`; // 09 + 8 số -> national bắt đầu '9', hợp lệ
}

function order(i: number) {
  return {
    brand_id: i % 2 === 0 ? "givral" : "ktt",
    store_id: "perf",
    source: "pos",
    occ_timestamp: "2026-06-18T10:00:00+07:00",
    identifiers: [{ type: "phone", value: phoneOf(i) }],
    properties: { pos_transaction_id: `PERF-${i}`, currency: "VND", total: 10000 + i, items: [] },
  };
}

beforeAll(async () => {
  await setupTestDb();
  await truncateAll();
  for (let i = 0; i < N; i++) {
    const r = await ingestOrderCompleted(pool, order(i) as never);
    phones.push(phoneOf(i));
    if (i === Math.floor(N / 2)) occSample = r.occId!;
  }
  await earn(pool, { occId: occSample, points: 500, idempotencyKey: "perf-earn" });
}, 120_000);

function pct(arr: number[], p: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
}

describe("PF-04/05/06: độ trễ thao tác chính ở quy mô", () => {
  it(`đã seed ${N} khách`, async () => {
    const r = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM cdp.canonical_transaction");
    expect(Number(r.rows[0]!.n)).toBe(N);
  });

  it("PF-04: 60 lookup ngẫu nhiên -> p95 < 300ms, mỗi lookup ra hồ sơ", async () => {
    const lat: number[] = [];
    for (let k = 0; k < 60; k++) {
      const phone = phones[(k * 7) % phones.length]!;
      const t0 = performance.now();
      const c = await getCustomer360(pool, { type: "phone", value: phone });
      lat.push(performance.now() - t0);
      expect(c).not.toBeNull();
    }
    const p95 = pct(lat, 95);
    console.log(`[PF-04] lookup p95=${p95.toFixed(1)}ms avg=${(lat.reduce((a, b) => a + b) / lat.length).toFixed(1)}ms`);
    expect(p95).toBeLessThan(300);
  });

  it("PF-06: segment preview trên dataset -> < 1500ms, count > 0", async () => {
    const t0 = performance.now();
    const seg = await previewSegment(pool, { minSpend: 10000 });
    const ms = performance.now() - t0;
    console.log(`[PF-06] segment preview=${ms.toFixed(1)}ms count=${seg.count}`);
    expect(seg.count).toBeGreaterThan(0);
    expect(seg.count).toBe(seg.occIds.length);
    expect(ms).toBeLessThan(1500);
  });

  it("PF-balance: getBalance < 200ms", async () => {
    const t0 = performance.now();
    const b = await getBalance(pool, occSample);
    const ms = performance.now() - t0;
    console.log(`[PF-balance] ${ms.toFixed(1)}ms`);
    expect(b.available).toBe(500);
    expect(ms).toBeLessThan(200);
  });
});
