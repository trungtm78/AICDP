// DEMO DATA: seed master + khách + giao dịch đa brand + consent + loyalty + recompute feature.
// Chạy: cd services/core-api && pnpm exec tsx scripts/seed-demo.ts
// An toàn chạy lại (idempotent theo pos_transaction_id + ON CONFLICT). Deterministic (seeded RNG).
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { ingestOrderCompleted } from "../src/ingestion/ingestion.service.js";
import { recordConsent } from "../src/consent/consent.service.js";
import { earn } from "../src/loyalty/loyalty.service.js";
import { recomputeAllFeatures } from "../src/feature/feature.service.js";

// PRNG tất định (mulberry32) — dữ liệu demo lặp lại như nhau mỗi lần chạy.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260619);
const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
const rint = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));

const BRANDS = ["givral", "kem_trang_tien", "hai_ha_kotobuki", "fuji", "origato"];
const CATS: [string, string][] = [
  ["banh", "Bánh"], ["kem", "Kem"], ["do_uong", "Đồ uống"], ["qua_tang", "Quà tặng"],
];
const PRODUCTS: [string, string, string, number][] = [
  // product_master_id, name, category_id, giá tham chiếu (VND)
  ["PM-BANHKEM", "Bánh kem", "banh", 250000],
  ["PM-BANHMI", "Bánh mì", "banh", 35000],
  ["PM-COOKIE", "Bánh quy", "banh", 90000],
  ["PM-KEMLY", "Kem ly", "kem", 45000],
  ["PM-KEMQUE", "Kem que", "kem", 25000],
  ["PM-CAPHE", "Cà phê", "do_uong", 55000],
  ["PM-TRASUA", "Trà sữa", "do_uong", 60000],
  ["PM-HOPQUA", "Hộp quà", "qua_tang", 480000],
];

async function seedMaster(): Promise<void> {
  for (const [id, name] of CATS)
    await pool.query(`INSERT INTO cdp.product_category (category_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, name]);
  for (const [id, name, cat] of PRODUCTS)
    await pool.query(
      `INSERT INTO cdp.product_master (product_master_id, name, category_id) VALUES ($1,$2,$3)
       ON CONFLICT (product_master_id) DO NOTHING`, [id, name, cat]);
  for (const b of BRANDS) {
    await pool.query(
      `INSERT INTO cdp.store (store_id, brand_id, name, region, city) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (store_id) DO NOTHING`,
      [`${b}-01`, b, `${b} - Cửa hàng 1`, "mien_nam", "TP.HCM"]);
    for (const [pm] of PRODUCTS)
      await pool.query(
        `INSERT INTO cdp.sku_mapping (brand_id, pos_sku, product_master_id) VALUES ($1,$2,$3)
         ON CONFLICT (brand_id, pos_sku) DO NOTHING`, [b, pm, pm]);
  }
}

function ts(daysAgo: number): string {
  const d = new Date("2026-06-19T04:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString();
}

async function main(): Promise<void> {
  await runMigrations(pool);
  await seedMaster();

  const N = 50;
  let txn = 0;
  let occSample = "";
  for (let i = 0; i < N; i++) {
    const phone = `09${String(10_000_000 + i * 131).padStart(8, "0")}`; // 09 + 8 số, hợp lệ
    const nBrands = rint(1, 3); // khách đa thương hiệu
    const custBrands = [...BRANDS].sort(() => r() - 0.5).slice(0, nBrands);
    const nOrders = rint(1, 8);
    // trải giao dịch: khách "cũ" (churned) hay "mới" tùy i
    const oldest = i % 7 === 0 ? 260 : i % 3 === 0 ? 120 : 40;
    let occId: string | null = null;
    for (let o = 0; o < nOrders; o++) {
      const brand = pick(custBrands);
      const nItems = rint(1, 3);
      const items: { sku: string; name: string; quantity: number; unit_price: number }[] = [];
      let total = 0;
      for (let k = 0; k < nItems; k++) {
        const [pm, name, , price] = pick(PRODUCTS);
        const qty = rint(1, 2);
        const up = price;
        items.push({ sku: pm, name, quantity: qty, unit_price: up });
        total += qty * up;
      }
      const daysAgo = rint(1, oldest);
      txn++;
      try {
        const res = await ingestOrderCompleted(pool, {
          brand_id: brand, store_id: `${brand}-01`, source: "pos",
          occ_timestamp: ts(daysAgo),
          identifiers: [{ type: "phone", value: phone }],
          properties: { pos_transaction_id: `DEMO-${i}-${o}`, currency: "VND", total, payment_method: pick(["cash", "card", "ewallet"]), items },
        } as never);
        occId = res.occId ?? occId;
      } catch { /* bỏ qua đơn lỗi */ }
    }
    if (!occId) continue;
    if (i === 5) occSample = occId;
    // Consent: ~60% granted email; ~35% sms; ~25% zalo
    if (r() < 0.6) await recordConsent(pool, { occId, purpose: "marketing_email", status: "granted", source: "import" });
    if (r() < 0.35) await recordConsent(pool, { occId, purpose: "marketing_sms", status: "granted", source: "import" });
    if (r() < 0.25) await recordConsent(pool, { occId, purpose: "marketing_zalo", status: "granted", source: "import" });
    // Loyalty: ~55% có điểm tích luỹ
    if (r() < 0.55) await earn(pool, { occId, points: rint(50, 800), idempotencyKey: `demo-earn-${i}` });
  }

  const feat = await recomputeAllFeatures(pool);
  const cnt = await pool.query<{ c: string; t: string }>(
    `SELECT (SELECT count(*) FROM cdp.occ_identity)::text c, (SELECT count(*) FROM cdp.canonical_transaction)::text t`);
  // eslint-disable-next-line no-console
  console.log(`Demo seed xong: ${cnt.rows[0]!.c} khách · ${cnt.rows[0]!.t} giao dịch · feature ${feat.count} khách. occ mẫu=${occSample}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
