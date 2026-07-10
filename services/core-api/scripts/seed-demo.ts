// ─────────────────────────────────────────────────────────────────────────────
// DEMO DATA — OCH (One Capital Hospitality)
// Xoá sạch data cũ → seed dữ liệu SÁT THỰC TẾ & ĐẦY ĐỦ để mọi màn có nội dung:
//   • 6 thương hiệu OCH thật (Givral, Kem Tràng Tiền, Fuji + KS Sunrise/StarCity/Dusit)
//   • cửa hàng địa chỉ thật, sản phẩm & giá VND thật
//   • ~320 khách (tên VN thật) · ~3.400 giao dịch cross-brand rải ~9 tháng
//   • identity merge (khách 2 định danh rời → hợp nhất) · consent hỗn hợp
//   • loyalty earn + reserve/capture/release (có lịch sử)
//   • 4 Journey (publish→activate→enroll→tick, có participant + report)
//   • activation runs · users (đăng nhập được) · api-keys · AI config (audit)
// Chạy: cd services/core-api && pnpm exec tsx scripts/seed-demo.ts
// Tất định (seeded RNG) — chạy lại cho kết quả như nhau (đã TRUNCATE trước).
// ─────────────────────────────────────────────────────────────────────────────
import { pool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { ingestOrderCompleted, ingestIdentify } from "../src/ingestion/ingestion.service.js";
import { recordConsent } from "../src/consent/consent.service.js";
import { earn, reserve, capture, release } from "../src/loyalty/loyalty.service.js";
import { recomputeAllFeatures } from "../src/feature/feature.service.js";
import { createDraft, publish, activateJourney } from "../src/journey/journey-admin.service.js";
import { enroll, enrollSegment, tick } from "../src/journey/journey-engine.service.js";
import { activate } from "../src/activation/activation.service.js";
import { createUser } from "../src/auth/user.service.js";
import { createApiKey } from "../src/auth/apikey.service.js";
import { setConfig } from "../src/ai-config/ai-config.service.js";
import { createConnection, createPipeline } from "../src/connector/connector.service.js";
import { recomputeAll } from "../src/prediction/prediction.service.js";
import { HttpPredictionProvider } from "../src/prediction/prediction.provider.js";
import { createOffer } from "../src/decisioning/offer.service.js";
import { createExperiment, assignAll } from "../src/decisioning/experiment.service.js";
import type { JourneyDefinition } from "../src/journey/journey.types.js";

// ── PRNG tất định (mulberry32) ──
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const r = rng(20260709);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const rint = (a: number, b: number): number => a + Math.floor(r() * (b - a + 1));
const chance = (p: number): boolean => r() < p;

// Mốc thời gian "hôm nay" của demo (khớp currentDate) — lùi daysAgo ngày.
const NOW = Date.UTC(2026, 6, 9, 4, 0, 0);
function ts(daysAgo: number): string {
  return new Date(NOW - daysAgo * 86_400_000).toISOString();
}
function dateOnly(daysAgo: number): string {
  return new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

// ── Master data OCH thật ──
type Region = "mien_bac" | "mien_trung" | "mien_nam";

const CATEGORIES: [string, string][] = [
  ["banh", "Bánh"],
  ["kem", "Kem"],
  ["do_uong", "Đồ uống"],
  ["qua_tang", "Quà tặng"],
  ["dong_lanh", "Thực phẩm đông lạnh"],
  ["luu_tru", "Lưu trú"],
  ["am_thuc_dv", "Ẩm thực & Dịch vụ"],
];

// product_master_id, name, category_id, giá VND, đơn vị
const PRODUCTS: [string, string, string, number, string][] = [
  // Givral (bánh — thương hiệu bánh Pháp lâu đời từ 1950)
  ["GV-BANHKEM", "Bánh kem sinh nhật", "banh", 320000, "cái"],
  ["GV-BANHMI", "Bánh mì Givral", "banh", 38000, "ổ"],
  ["GV-SUKEM", "Bánh su kem", "banh", 22000, "cái"],
  ["GV-BONGLAN", "Bánh bông lan trứng muối", "banh", 45000, "cái"],
  ["GV-CROISSANT", "Bánh sừng bò (croissant)", "banh", 35000, "cái"],
  ["GV-COOKIE", "Hộp cookie bơ", "qua_tang", 165000, "hộp"],
  ["GV-TRUNGTHU", "Bánh trung thu", "qua_tang", 85000, "cái"],
  ["GV-CAPHE", "Cà phê", "do_uong", 45000, "ly"],
  // Kem Tràng Tiền (kem — thương hiệu kem Hà Nội từ 1958)
  ["KTT-QUE-DAUXANH", "Kem que đậu xanh", "kem", 15000, "que"],
  ["KTT-QUE-COM", "Kem que cốm", "kem", 15000, "que"],
  ["KTT-OCQUE-SOCOLA", "Kem ốc quế sô cô la", "kem", 20000, "cái"],
  ["KTT-LY-SUADUA", "Kem ly sữa dừa", "kem", 25000, "ly"],
  ["KTT-HOP", "Kem hộp gia đình", "kem", 90000, "hộp"],
  // Fuji (thực phẩm đông lạnh — kênh siêu thị)
  ["FJ-DIMSUM", "Dimsum tôm đông lạnh", "dong_lanh", 95000, "gói"],
  ["FJ-HACAO", "Há cảo hấp", "dong_lanh", 78000, "gói"],
  ["FJ-CHAGIO", "Chả giò hải sản", "dong_lanh", 68000, "gói"],
  ["FJ-SUICAO", "Sủi cảo nhân thịt", "dong_lanh", 72000, "gói"],
  ["FJ-BANHBAO", "Bánh bao kim sa", "dong_lanh", 65000, "gói"],
  // Khách sạn (Sunrise / StarCity / Dusit) — dùng chung product master lưu trú & dịch vụ
  ["HTL-DELUXE", "Đêm nghỉ phòng Deluxe", "luu_tru", 1800000, "đêm"],
  ["HTL-SUITE", "Đêm nghỉ phòng Suite", "luu_tru", 3500000, "đêm"],
  ["HTL-BUFFET", "Buffet sáng", "am_thuc_dv", 350000, "suất"],
  ["HTL-SETMENU", "Set menu nhà hàng", "am_thuc_dv", 650000, "suất"],
  ["HTL-SPA", "Gói Spa thư giãn", "am_thuc_dv", 900000, "gói"],
  ["HTL-HALL", "Sảnh tiệc / hội nghị", "am_thuc_dv", 15000000, "sự kiện"],
];
const PRICE = new Map(PRODUCTS.map((p) => [p[0], p[3]]));

// Cửa hàng địa chỉ thật (OCH)
interface StoreDef { id: string; brand: string; name: string; region: Region; city: string; address: string }
const STORES: StoreDef[] = [
  { id: "givral-dongkhoi", brand: "givral", name: "Givral Đồng Khởi", region: "mien_nam", city: "TP.HCM", address: "169 Đồng Khởi, Quận 1, TP.HCM" },
  { id: "givral-lethanhton", brand: "givral", name: "Givral Lê Thánh Tôn", region: "mien_nam", city: "TP.HCM", address: "Lê Thánh Tôn, Quận 1, TP.HCM" },
  { id: "givral-crescent", brand: "givral", name: "Givral Crescent Mall", region: "mien_nam", city: "TP.HCM", address: "Crescent Mall, Phú Mỹ Hưng, Quận 7, TP.HCM" },
  { id: "givral-hanoi", brand: "givral", name: "Givral Tràng Tiền Plaza", region: "mien_bac", city: "Hà Nội", address: "Tràng Tiền Plaza, Hoàn Kiếm, Hà Nội" },
  { id: "ktt-trangtien", brand: "kem_trang_tien", name: "Kem Tràng Tiền 35 Tràng Tiền", region: "mien_bac", city: "Hà Nội", address: "35 Tràng Tiền, Hoàn Kiếm, Hà Nội" },
  { id: "ktt-vincom", brand: "kem_trang_tien", name: "Kem Tràng Tiền Vincom Bà Triệu", region: "mien_bac", city: "Hà Nội", address: "Vincom Bà Triệu, Hai Bà Trưng, Hà Nội" },
  { id: "ktt-timescity", brand: "kem_trang_tien", name: "Kem Tràng Tiền Times City", region: "mien_bac", city: "Hà Nội", address: "Times City, Hoàng Mai, Hà Nội" },
  { id: "fuji-hcm", brand: "fuji", name: "Fuji Foods — Kênh siêu thị HCM", region: "mien_nam", city: "TP.HCM", address: "Trung tâm phân phối HCM" },
  { id: "fuji-hn", brand: "fuji", name: "Fuji Foods — Kênh siêu thị Hà Nội", region: "mien_bac", city: "Hà Nội", address: "Trung tâm phân phối Hà Nội" },
  { id: "sunrise-nt", brand: "sunrise_nha_trang", name: "Sunrise Nha Trang Beach Hotel & Spa", region: "mien_trung", city: "Nha Trang", address: "12-14 Trần Phú, Nha Trang, Khánh Hòa" },
  { id: "starcity-nt", brand: "starcity_nha_trang", name: "StarCity Nha Trang Hotel", region: "mien_trung", city: "Nha Trang", address: "72-74 Trần Phú, Nha Trang, Khánh Hòa" },
  { id: "dusit-hn", brand: "dusit_hanoi", name: "Dusit Le Palais Tu Hoa", region: "mien_bac", city: "Hà Nội", address: "27 Tô Ngọc Vân, Tây Hồ, Hà Nội" },
];

// SKU mỗi brand bán (pos_sku = product_master_id cho đơn giản)
const BRAND_SKUS: Record<string, string[]> = {
  givral: PRODUCTS.filter((p) => p[0].startsWith("GV-")).map((p) => p[0]),
  kem_trang_tien: PRODUCTS.filter((p) => p[0].startsWith("KTT-")).map((p) => p[0]),
  fuji: PRODUCTS.filter((p) => p[0].startsWith("FJ-")).map((p) => p[0]),
  sunrise_nha_trang: PRODUCTS.filter((p) => p[0].startsWith("HTL-")).map((p) => p[0]),
  starcity_nha_trang: PRODUCTS.filter((p) => p[0].startsWith("HTL-")).map((p) => p[0]),
  dusit_hanoi: PRODUCTS.filter((p) => p[0].startsWith("HTL-")).map((p) => p[0]),
};
const OCH_BRANDS = Object.keys(BRAND_SKUS);
const STORES_BY_BRAND: Record<string, StoreDef[]> = Object.fromEntries(
  OCH_BRANDS.map((b) => [b, STORES.filter((s) => s.brand === b)]),
);

// ── Tên khách VN thật ──
const HO = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"];
const DEM_NAM = ["Văn", "Hữu", "Đức", "Minh", "Quang", "Thành", "Công", "Bá", "Xuân"];
const DEM_NU = ["Thị", "Ngọc", "Thu", "Thanh", "Kim", "Mỹ", "Hồng", "Phương"];
const TEN_NAM = ["An", "Bình", "Cường", "Dũng", "Hải", "Hùng", "Khoa", "Long", "Nam", "Phúc", "Quân", "Sơn", "Tuấn", "Việt", "Bảo", "Đạt", "Khang", "Trí"];
const TEN_NU = ["An", "Chi", "Dung", "Hà", "Hoa", "Lan", "Linh", "Mai", "Nga", "Nhung", "Oanh", "Quỳnh", "Thảo", "Trang", "Vy", "Yến", "Hương", "Ngân"];
const CITIES = ["TP.HCM", "Hà Nội", "Đà Nẵng", "Nha Trang", "Hải Phòng", "Cần Thơ", "Biên Hòa", "Huế"];

function noAccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

interface Customer {
  fullName: string;
  gender: "male" | "female";
  phone: string;
  email: string;
  loyaltyCard: string | null;
  birthDate: string;
  city: string;
  brands: string[];
  orders: number;
  recencyDay: number; // số ngày kể từ đơn GẦN NHẤT → quyết định lifecycle
  ageSpan: number; // độ rộng lịch sử mua (ngày) tính từ recencyDay lùi về
  merge: boolean; // khách demo hợp nhất định danh
}

function buildCustomers(n: number): Customer[] {
  const list: Customer[] = [];
  for (let i = 0; i < n; i++) {
    const female = chance(0.5);
    const ho = pick(HO);
    const dem = female ? pick(DEM_NU) : pick(DEM_NAM);
    const ten = female ? pick(TEN_NU) : pick(TEN_NAM);
    const fullName = `${ho} ${dem} ${ten}`;
    const slug = noAccent(`${ten}.${ho}`).toLowerCase().replace(/\s+/g, "");
    const phone = `0${pick(["9", "8", "7", "3", "5"])}${String(10_000_000 + i * 97 + rint(0, 90)).padStart(8, "0").slice(0, 8)}`;
    const email = `${slug}${i}@${pick(["gmail.com", "yahoo.com", "outlook.com", "icloud.com"])}`;
    // Phân bổ thương hiệu THỰC TẾ: F&B chiếm ~90% doanh thu OCH → đa số khách F&B
    // (chi tiêu vừa phải), khách sạn là thiểu số (chi tiêu cao), một nhóm nhỏ cross F&B+KS
    // (giá trị cao nhất). Tạo phân bố hạng tự nhiên (Đồng nhiều → Kim cương hiếm).
    const FNB = ["givral", "kem_trang_tien", "fuji"];
    const HOTELS = ["sunrise_nha_trang", "starcity_nha_trang", "dusit_hanoi"];
    const seg = r();
    let brands: string[];
    if (seg < 0.7) {
      brands = chance(0.28) ? [...FNB].sort(() => r() - 0.5).slice(0, 2) : [pick(FNB)];
    } else if (seg < 0.9) {
      brands = chance(0.35) ? [pick(HOTELS), pick(FNB)] : [pick(HOTELS)];
    } else {
      brands = [pick(FNB), pick(HOTELS)];
    }
    // Lifecycle spread (ngưỡng mặc định: at_risk≥60, dormant≥90, churned≥180 ngày):
    //   bucket 0: mới · 1-4: active · 5-6: at_risk · 7-8: dormant · 9: churned
    const bucket = i % 10;
    const recencyDay =
      bucket === 0 ? rint(3, 14)
      : bucket <= 4 ? rint(1, 55)
      : bucket <= 6 ? rint(60, 88)
      : bucket <= 8 ? rint(92, 175)
      : rint(185, 285);
    const orders = bucket === 0 ? 1 : rint(2, 18);
    list.push({
      fullName,
      gender: female ? "female" : "male",
      phone,
      email,
      loyaltyCard: chance(0.55) ? `OCH${String(100000 + i).padStart(6, "0")}` : null,
      birthDate: `${rint(1975, 2003)}-${String(rint(1, 12)).padStart(2, "0")}-${String(rint(1, 28)).padStart(2, "0")}`,
      city: pick(CITIES),
      brands,
      orders,
      recencyDay,
      ageSpan: rint(30, 220),
      merge: i % 22 === 7, // ~1/22 khách là ca hợp nhất định danh
    });
  }
  return list;
}

// Pool sản phẩm khách sạn CÓ TRỌNG SỐ: chủ yếu lưu trú/ẩm thực thường ngày; SUITE thi thoảng;
// HTL-HALL (sự kiện 15M) rất hiếm (không để 1 đơn tiệc làm lệch toàn bộ chi tiêu).
const HOTEL_POOL: string[] = [
  ...Array(6).fill("HTL-BUFFET"), ...Array(5).fill("HTL-DELUXE"), ...Array(4).fill("HTL-SETMENU"),
  ...Array(3).fill("HTL-SPA"), ...Array(2).fill("HTL-SUITE"), "HTL-HALL",
];
const isHotel = (brand: string): boolean => brand.startsWith("sunrise") || brand.startsWith("starcity") || brand.startsWith("dusit");

interface OrderItem { sku: string; name: string; quantity: number; unit_price: number }
function orderItems(brand: string): { items: OrderItem[]; total: number } {
  const pool = isHotel(brand) ? HOTEL_POOL : BRAND_SKUS[brand]!;
  const nItems = rint(1, 3);
  let total = 0;
  const items: OrderItem[] = [];
  for (let k = 0; k < nItems; k++) {
    const sku = pick(pool);
    const meta = PRODUCTS.find((p) => p[0] === sku)!;
    const qty = sku.startsWith("HTL-") ? rint(1, 2) : rint(1, 4);
    const up = PRICE.get(sku)!;
    items.push({ sku, name: meta[1], quantity: qty, unit_price: up });
    total += qty * up;
  }
  return { items, total };
}

async function seedMaster(): Promise<void> {
  for (const [id, name] of CATEGORIES)
    await pool.query(`INSERT INTO cdp.product_category (category_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, name]);
  for (const [id, name, cat, , unit] of PRODUCTS)
    await pool.query(
      `INSERT INTO cdp.product_master (product_master_id, name, category_id, unit) VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_master_id) DO NOTHING`, [id, name, cat, unit]);
  for (const s of STORES)
    await pool.query(
      `INSERT INTO cdp.store (store_id, brand_id, name, region, city, address) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (store_id) DO NOTHING`, [s.id, s.brand, s.name, s.region, s.city, s.address]);
  for (const [brand, skus] of Object.entries(BRAND_SKUS))
    for (const sku of skus)
      await pool.query(
        `INSERT INTO cdp.sku_mapping (brand_id, pos_sku, product_master_id) VALUES ($1,$2,$3)
         ON CONFLICT (brand_id, pos_sku) DO NOTHING`, [brand, sku, sku]);
}

async function placeOrder(
  brand: string,
  identifiers: { type: "phone" | "email" | "loyalty_card"; value: string }[],
  daysAgo: number,
  txnKey: string,
): Promise<string | null> {
  const store = pick(STORES_BY_BRAND[brand]!);
  const oi = orderItems(brand);
  try {
    const res = await ingestOrderCompleted(pool, {
      brand_id: brand,
      store_id: store.id,
      source: "pos",
      occ_timestamp: ts(daysAgo),
      identifiers,
      properties: {
        pos_transaction_id: txnKey,
        currency: "VND",
        total: oi.total,
        payment_method: pick(["cash", "card", "ewallet", "bank_transfer"]),
        business_date: dateOnly(daysAgo),
        items: oi.items,
      },
    } as never);
    return res.occId ?? null;
  } catch {
    return null;
  }
}

// ── Reset sạch + đảm bảo đúng 6 brand OCH ──
async function resetAll(): Promise<void> {
  await pool.query(
    `TRUNCATE cdp.experiment_assignment, cdp.experiment, cdp.offer_catalog,
              cdp.analytics_alert, cdp.model_feature_importance, cdp.model_card, cdp.ml_model, cdp.customer_prediction,
              cdp.ai_llm_usage, cdp.ai_config_audit, cdp.ai_config, cdp.customer_feature,
              cdp.journey_step_run, cdp.journey_participant, cdp.journey_version,
              cdp.journey_run, cdp.journey, cdp.cart, cdp.password_reset,
              cdp.pipeline, cdp.connection, cdp.connector,
              cdp.activation_member, cdp.activation_run, cdp.consent_record,
              cdp.loyalty_entry, cdp.loyalty_reservation, cdp.loyalty_txn,
              cdp.canonical_transaction, cdp.ingest_event, cdp.identity_edge,
              cdp.identity_merge_log, cdp.profile, cdp.occ_identity,
              cdp.store, cdp.sku_mapping, cdp.product_master, cdp.product_category,
              cdp.app_user, cdp.api_key
     RESTART IDENTITY CASCADE`,
  );
  // Chỉ giữ đúng 6 thương hiệu OCH (loại reference data cũ nếu có).
  await pool.query(`DELETE FROM cdp.brand WHERE brand_id <> ALL($1::text[])`, [OCH_BRANDS]);
}

// ── Journey helpers ──
// Tự bố trí vị trí node trái→phải (x theo độ sâu từ entry, y giãn theo nhánh) để canvas
// hiển thị lưu đồ đẹp (nếu không set pos, mọi node chồng lên nhau).
function withLayout(def: JourneyDefinition): JourneyDefinition {
  const depth = new Map<string, number>();
  const entry = def.nodes.find((n) => n.type === "entry");
  if (entry) depth.set(entry.id, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of def.edges) {
      const d = depth.get(e.from);
      if (d !== undefined && (depth.get(e.to) ?? -1) < d + 1) { depth.set(e.to, d + 1); changed = true; }
    }
  }
  const byDepth = new Map<number, string[]>();
  for (const n of def.nodes) {
    const d = depth.get(n.id) ?? 0;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(n.id);
  }
  const nodes = def.nodes.map((n) => {
    const d = depth.get(n.id) ?? 0;
    const sibs = byDepth.get(d)!;
    const idx = sibs.indexOf(n.id);
    return { ...n, pos: { x: 60 + d * 260, y: 200 + idx * 150 - ((sibs.length - 1) * 75) } };
  });
  return { nodes, edges: def.edges };
}

async function runJourney(
  name: string,
  triggerType: "event" | "segment" | "manual",
  triggerConfig: Record<string, unknown>,
  rawDef: JourneyDefinition,
  opts: { enrollOccIds?: string[]; enrollSegment?: boolean; ticks: number },
): Promise<{ id: string; enrolled: number }> {
  const def = withLayout(rawDef);
  const j = await createDraft(pool, { name, triggerType, triggerConfig, definition: def });
  await publish(pool, j.journey_id, "admin");
  await activateJourney(pool, j.journey_id);
  let enrolled = 0;
  if (opts.enrollSegment) {
    enrolled = await enrollSegment(pool, j.journey_id);
  } else if (opts.enrollOccIds) {
    for (const occId of opts.enrollOccIds) {
      const res = await enroll(pool, j.journey_id, occId);
      if (res.enrolled) enrolled++;
    }
  }
  for (let t = 0; t < opts.ticks; t++) await tick(pool, { limit: 500 });
  return { id: j.journey_id, enrolled };
}

async function main(): Promise<void> {
  await runMigrations(pool);
  await resetAll();
  await seedMaster();

  const customers = buildCustomers(320);
  const occIds: string[] = [];
  const occByCustomer = new Map<number, string>();
  let txnCount = 0;
  let mergeCount = 0;

  for (let i = 0; i < customers.length; i++) {
    const c = customers[i]!;
    const idPhone = { type: "phone" as const, value: c.phone };
    const idEmail = { type: "email" as const, value: c.email };
    const idsFull: { type: "phone" | "email" | "loyalty_card"; value: string }[] = [idPhone, idEmail];
    if (c.loyaltyCard) idsFull.push({ type: "loyalty_card", value: c.loyaltyCard });

    if (c.merge) {
      // Ca HỢP NHẤT: tạo 2 hồ sơ RỜI (phone-only, email-only) rồi đơn cuối mang cả 2 → merge.
      await ingestIdentify(pool, {
        brand_id: c.brands[0]!,
        identifiers: [idPhone],
        traits: { full_name: c.fullName, phone: c.phone, birth_date: c.birthDate, gender: c.gender, city: c.city },
      });
      await ingestIdentify(pool, { brand_id: c.brands[0]!, identifiers: [idEmail], traits: { email: c.email } });
    } else {
      // Định danh hợp nhất + traits (điền profile cho Customer 360)
      await ingestIdentify(pool, {
        brand_id: c.brands[0]!,
        identifiers: idsFull,
        traits: {
          full_name: c.fullName,
          phone: c.phone,
          email: c.email,
          birth_date: c.birthDate,
          gender: c.gender,
          city: c.city,
        },
      });
    }

    // Giao dịch: đơn gần nhất = recencyDay ngày trước; các đơn còn lại rải về quá khứ.
    let occId: string | null = null;
    for (let o = 0; o < c.orders; o++) {
      const brand = pick(c.brands);
      const daysAgo = o === 0 ? c.recencyDay : c.recencyDay + rint(1, c.ageSpan);
      // Ca merge: đơn đầu dùng email-only, đơn cuối dùng CẢ HAI (kích hoạt hợp nhất), còn lại phone.
      const useIds = c.merge
        ? o === 0 ? [idEmail] : o === c.orders - 1 ? idsFull : [idPhone]
        : idsFull;
      txnCount++;
      const res = await placeOrder(brand, useIds, daysAgo, `OCH-${i}-${o}`);
      occId = res ?? occId;
    }
    if (c.merge) mergeCount++;
    if (!occId) continue;
    occIds.push(occId);
    occByCustomer.set(i, occId);

    // Consent hỗn hợp (chỉ activation mới gate — ingestion/loyalty luôn nhận)
    if (chance(0.65)) await recordConsent(pool, { occId, purpose: "marketing_email", status: "granted", source: "import" });
    if (chance(0.4)) await recordConsent(pool, { occId, purpose: "marketing_sms", status: "granted", source: "import" });
    if (chance(0.3)) await recordConsent(pool, { occId, purpose: "marketing_zalo", status: "granted", source: "import" });
    if (chance(0.08)) await recordConsent(pool, { occId, purpose: "marketing_email", status: "withdrawn", source: "csr", channel: "hotline" });

    // Loyalty: earn tỷ lệ theo số đơn (khách nhiều đơn điểm cao)
    if (chance(0.72)) {
      const pts = rint(50, 200) * Math.max(1, Math.floor(c.orders / 2));
      await earn(pool, { occId, points: Math.min(pts, 50000), idempotencyKey: `demo-earn-${i}` });
    }
  }

  // Loyalty reserve/capture/release — tạo lịch sử đổi điểm cho ~24 khách đầu có điểm
  let redeemed = 0;
  for (let i = 0; i < customers.length && redeemed < 24; i++) {
    const occId = occByCustomer.get(i);
    if (!occId) continue;
    try {
      const rv = await reserve(pool, { occId, points: 50, idempotencyKey: `demo-reserve-${i}` });
      if (i % 4 === 0) {
        await release(pool, { reservationId: rv.reservationId, idempotencyKey: `demo-release-${i}` });
      } else {
        await capture(pool, { reservationId: rv.reservationId, idempotencyKey: `demo-capture-${i}` });
      }
      redeemed++;
    } catch { /* số dư không đủ → bỏ qua */ }
  }

  // Giỏ hàng đang mở / BỎ QUÊN (~24% khách) — cơ hội thúc đẩy hoàn tất đơn.
  let carts = 0;
  const cartOccIds: string[] = [];
  for (let i = 0; i < customers.length; i++) {
    const occId = occByCustomer.get(i);
    if (!occId) continue;
    const roll = r();
    if (roll > 0.24) continue;
    cartOccIds.push(occId);
    const c = customers[i]!;
    const brand = pick(c.brands);
    const oi = orderItems(brand);
    const abandoned = roll > 0.07; // đa số là giỏ bỏ quên (abandoned), số ít đang mở
    const hoursAgo = abandoned ? rint(4, 260) : rint(0, 6);
    const store = pick(STORES_BY_BRAND[brand]!);
    const updatedAt = new Date(NOW - hoursAgo * 3_600_000).toISOString();
    await pool.query(
      `INSERT INTO cdp.cart (occ_id, brand_id, store_id, channel, status, items, value, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$8)`,
      [occId, brand, store.id, pick(["web", "app", "pos"]), abandoned ? "abandoned" : "active",
       JSON.stringify(oi.items), oi.total, updatedAt],
    );
    carts++;
  }

  // Recompute feature TRƯỚC khi chạy journey theo segment (segment đọc customer_feature)
  await recomputeAllFeatures(pool);

  // ── Journeys (7 kịch bản đa dạng — participant rải nhiều trạng thái để report phong phú) ──
  const A = (purpose: string, channel: string, destination: string) =>
    ({ kind: "activation" as const, purpose, channel, destination });

  // 1) Chào mừng khách mới (event) — tặng điểm rồi hoàn tất.
  const j1: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "event", eventName: "order_completed" } },
      { id: "bonus", type: "action", config: { kind: "loyalty_bonus", points: 100 } },
      { id: "x", type: "exit" },
    ],
    edges: [{ from: "e", to: "bonus" }, { from: "bonus", to: "x" }],
  };
  const r1 = await runJourney("Chào mừng khách hàng mới", "event", { eventName: "order_completed" }, j1, { enrollOccIds: occIds.slice(0, 70), ticks: 5 });

  // 2) Nhắc GIỎ HÀNG BỎ QUÊN — gửi email nhắc hoàn tất đơn (enroll khách có giỏ).
  const j2: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "manual" } },
      { id: "cond", type: "condition", config: { predicate: { kind: "consentGranted", purpose: "marketing_email" } } },
      { id: "act", type: "action", config: A("marketing_email", "email", "esp:sendgrid") },
      { id: "wait", type: "wait", config: { delayMinutes: 1440 } },
      { id: "x", type: "exit" },
    ],
    edges: [
      { from: "e", to: "cond" },
      { from: "cond", to: "act", branch: "yes" }, { from: "cond", to: "x", branch: "no" },
      { from: "act", to: "wait" }, { from: "wait", to: "x" },
    ],
  };
  const r2 = await runJourney("Nhắc giỏ hàng bỏ quên", "manual", {}, j2, { enrollOccIds: cartOccIds, ticks: 4 });

  // 3) Thưởng khách VIP Givral (segment) — điều kiện điểm → gửi ưu đãi.
  const j3: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "segment", segment: { brandId: "givral", loyaltyMin: 300 } } },
      { id: "cond", type: "condition", config: { predicate: { kind: "loyaltyMinGte", value: 500 } } },
      { id: "act", type: "action", config: A("marketing_email", "email", "esp:sendgrid") },
      { id: "x", type: "exit" },
    ],
    edges: [
      { from: "e", to: "cond" },
      { from: "cond", to: "act", branch: "yes" }, { from: "cond", to: "x", branch: "no" },
      { from: "act", to: "x" },
    ],
  };
  const r3 = await runJourney("Thưởng khách VIP Givral", "segment", {}, j3, { enrollSegment: true, ticks: 5 });

  // 4) Tri ân khách KIM CƯƠNG (chi tiêu ≥ 50tr) — Zalo ZNS + chờ 3 ngày.
  const j4: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "segment", segment: { minSpend: 50_000_000 } } },
      { id: "act", type: "action", config: A("marketing_zalo", "zalo", "zalo:zns") },
      { id: "wait", type: "wait", config: { delayMinutes: 4320 } },
      { id: "x", type: "exit" },
    ],
    edges: [{ from: "e", to: "act" }, { from: "act", to: "wait" }, { from: "wait", to: "x" }],
  };
  const r4 = await runJourney("Tri ân khách hàng Kim cương", "segment", {}, j4, { enrollSegment: true, ticks: 4 });

  // 5) Kéo lại khách NGỦ ĐÔNG (dormant) — điều kiện consent → email → chờ.
  const j5: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "segment", segment: { lifecycleStage: "dormant" } } },
      { id: "cond", type: "condition", config: { predicate: { kind: "consentGranted", purpose: "marketing_email" } } },
      { id: "act", type: "action", config: A("marketing_email", "email", "esp:sendgrid") },
      { id: "wait", type: "wait", config: { delayMinutes: 4320 } },
      { id: "x", type: "exit" },
    ],
    edges: [
      { from: "e", to: "cond" },
      { from: "cond", to: "act", branch: "yes" }, { from: "cond", to: "x", branch: "no" },
      { from: "act", to: "wait" }, { from: "wait", to: "x" },
    ],
  };
  const r5 = await runJourney("Kéo lại khách ngủ đông", "segment", {}, j5, { enrollSegment: true, ticks: 4 });

  // 6) Chăm sóc khách CÓ NGUY CƠ RỜI (at_risk) — điều kiện consent SMS → SMS.
  const j6: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "segment", segment: { lifecycleStage: "at_risk" } } },
      { id: "cond", type: "condition", config: { predicate: { kind: "consentGranted", purpose: "marketing_sms" } } },
      { id: "act", type: "action", config: A("marketing_sms", "sms", "sms:vietguys") },
      { id: "x", type: "exit" },
    ],
    edges: [
      { from: "e", to: "cond" },
      { from: "cond", to: "act", branch: "yes" }, { from: "cond", to: "x", branch: "no" },
      { from: "act", to: "x" },
    ],
  };
  const r6 = await runJourney("Chăm sóc khách có nguy cơ rời", "segment", {}, j6, { enrollSegment: true, ticks: 5 });

  // 7) Ưu đãi lưu trú khách sạn Sunrise (segment brand) — SMS ngay.
  const j7: JourneyDefinition = {
    nodes: [
      { id: "e", type: "entry", config: { trigger: "segment", segment: { brandId: "sunrise_nha_trang" } } },
      { id: "act", type: "action", config: A("marketing_sms", "sms", "sms:vietguys") },
      { id: "x", type: "exit" },
    ],
    edges: [{ from: "e", to: "act" }, { from: "act", to: "x" }],
  };
  const r7 = await runJourney("Ưu đãi lưu trú khách sạn Sunrise", "segment", {}, j7, { enrollSegment: true, ticks: 4 });

  // ── Activation runs độc lập (lịch sử kích hoạt) ──
  const seg = occIds.slice(50, 140);
  await activate(pool, { audienceName: "KH thân thiết — Newsletter tháng 7", purpose: "marketing_email", channel: "email", destination: "esp:sendgrid", occIds: seg });
  await activate(pool, { audienceName: "Ưu đãi sinh nhật — SMS", purpose: "marketing_sms", channel: "sms", destination: "sms:vietguys", occIds: occIds.slice(20, 90) });
  await activate(pool, { audienceName: "Khách hàng cao cấp — Zalo ZNS", purpose: "marketing_zalo", channel: "zalo", destination: "zalo:zns", occIds: occIds.slice(0, 60) });

  // ── Users (đăng nhập được) ──
  const users: [string, string, "admin" | "data_steward" | "marketer" | "csr" | "analyst" | "compliance" | "executive", string][] = [
    ["admin", "Och@2026", "admin", "Quản trị hệ thống OCH"],
    ["steward", "Och@2026", "data_steward", "Nguyễn Thị Data Steward"],
    ["marketer", "Och@2026", "marketer", "Trần Minh Marketer"],
    ["csr", "Och@2026", "csr", "Lê Thị CSKH"],
    ["analyst", "Och@2026", "analyst", "Phạm Văn Analyst"],
    ["compliance", "Och@2026", "compliance", "Hoàng Thị Compliance"],
    ["executive", "Och@2026", "executive", "Vũ Đức Executive"],
  ];
  for (const [username, password, role, name] of users)
    await createUser(pool, { username, password, role, name });

  // ── API keys (service-to-service) ──
  await createApiKey(pool, { name: "POS Connector — Givral/KTT/Fuji", role: "connector" });
  await createApiKey(pool, { name: "PMS Connector — Khách sạn", role: "connector" });
  await createApiKey(pool, { name: "Reverse-ETL → Data Warehouse", role: "analyst" });

  // ── Connectors & Pipelines dựng sẵn (workspace Kết nối) ──
  const connsSeed: { name: string; direction: "source" | "destination"; connectorKey: string; status: "active" | "paused" }[] = [
    { name: "POS Givral — Đồng Khởi", direction: "source", connectorKey: "src_pos", status: "active" },
    { name: "PMS Sunrise Nha Trang", direction: "source", connectorKey: "src_pms", status: "active" },
    { name: "Website OCH (JS SDK)", direction: "source", connectorKey: "src_js", status: "active" },
    { name: "Zalo ZNS — Chăm sóc KH", direction: "destination", connectorKey: "dst_zalo_zns", status: "active" },
    { name: "SendGrid — Email marketing", direction: "destination", connectorKey: "dst_sendgrid", status: "active" },
    { name: "Google Ads — Audience", direction: "destination", connectorKey: "dst_google_ads", status: "paused" },
    { name: "ClickHouse — Kho phân tích", direction: "destination", connectorKey: "dst_clickhouse", status: "active" },
  ];
  for (const c of connsSeed) await createConnection(pool, { name: c.name, direction: c.direction, connectorKey: c.connectorKey, status: c.status });

  const pipe = (name: string, kind: "event_stream" | "reverse_etl", src: string, tf: string, dst: string) =>
    createPipeline(pool, {
      name, kind, status: "active",
      definition: {
        nodes: [
          { id: "s", type: "source", config: { connectorKey: src }, pos: { x: 60, y: 180 } },
          { id: "t", type: "transform", config: { kind: tf }, pos: { x: 340, y: 180 } },
          { id: "d", type: "destination", config: { connectorKey: dst }, pos: { x: 620, y: 180 } },
        ],
        edges: [{ from: "s", to: "t" }, { from: "t", to: "d" }],
      },
    });
  await pipe("Thu POS F&B → CDP", "event_stream", "src_pos", "normalize", "dst_clickhouse");
  await pipe("CDP → Zalo ZNS (lọc consent)", "reverse_etl", "src_pg", "consent_filter", "dst_zalo_zns");
  await pipe("CDP → Google Ads Audience", "reverse_etl", "src_pg", "audience", "dst_google_ads");

  // ── AI config (tạo audit log cho AI & Governance) ──
  await setConfig(pool, "features", { recoV2: true, nba: true, forecast: true, assistant: true }, "admin");
  await setConfig(pool, "reco", { topN: 6, diversityWeight: 0.35, enableCrossBrand: true, enableMarketBasket: true, boost: [], bury: [] }, "admin");
  await setConfig(pool, "forecast", { periods: 6, window: 3, granularity: "month" }, "admin");
  // LLM: demo dùng OpenAI (key qua ENV OPENAI_API_KEY lúc chạy core-api). Chọn OpenAI cho mọi
  // task để Trợ lý AI / narrative / NLQ chạy thật. Không có key -> tính năng tự fallback/ báo rõ.
  await setConfig(pool, "llm", {
    defaultProvider: "openai", piiPolicy: "redact",
    tasks: {
      ask: { provider: "openai", model: "gpt-4o-mini" },
      segment: { provider: "openai", model: "gpt-4o-mini" },
      content: { provider: "openai", model: "gpt-4o-mini" },
      explain: { provider: "openai", model: "gpt-4o-mini" },
    },
  }, "admin");

  // Backdate enroll journey ~100 ngày để attribution (doanh thu sau enroll) có dữ liệu demo.
  await pool.query("UPDATE cdp.journey_participant SET enrolled_at = now() - interval '100 days'");

  // ── Dự đoán ML (customer_prediction): thử ai-service, không có thì fallback heuristic ──
  const predRes = await recomputeAll(pool, new HttpPredictionProvider());

  // ── Decisioning: offer catalog + 1 experiment A/B (gán biến thể để đo uplift) ──
  await createOffer(pool, { name: "Thưởng 200đ tri ân VIP", kind: "loyalty_bonus", baseValue: 200000, eligibility: "vip" });
  await createOffer(pool, { name: "Win-back email -20%", kind: "activation", purpose: "marketing_email", channel: "email", baseValue: 150000, eligibility: "at_risk" });
  await createOffer(pool, { name: "Cross-sell nhóm hàng", kind: "content", baseValue: 80000 }); // phổ quát (fallback)
  await createOffer(pool, { name: "Zalo ZNS ưu đãi", kind: "activation", purpose: "marketing_zalo", channel: "zalo", baseValue: 120000 });
  const exp = await createExperiment(pool, { name: "Win-back email A/B", holdoutPct: 20 });
  await assignAll(pool, exp.id);
  // Backdate thời điểm gán để "chuyển đổi = giao dịch sau khi gán" có dữ liệu (demo uplift).
  await pool.query("UPDATE cdp.experiment_assignment SET assigned_at = now() - interval '120 days' WHERE experiment_id=$1", [exp.id]);

  // ── Summary ──
  const cnt = await pool.query<{ khach: string; gd: string; brands: string; stores: string; journeys: string; runs: string; users: string; keys: string }>(
    `SELECT (SELECT count(*) FROM cdp.occ_identity)::text khach,
            (SELECT count(*) FROM cdp.canonical_transaction)::text gd,
            (SELECT count(*) FROM cdp.brand)::text brands,
            (SELECT count(*) FROM cdp.store)::text stores,
            (SELECT count(*) FROM cdp.journey)::text journeys,
            (SELECT count(*) FROM cdp.activation_run)::text runs,
            (SELECT count(*) FROM cdp.app_user)::text users,
            (SELECT count(*) FROM cdp.api_key)::text keys`);
  const merges = await pool.query<{ c: string }>(`SELECT count(*)::text c FROM cdp.identity_merge_log`);
  const s = cnt.rows[0]!;
  // eslint-disable-next-line no-console
  console.log(
    `\n✅ Demo OCH seed xong:\n` +
    `   • ${s.brands} thương hiệu · ${s.stores} cửa hàng\n` +
    `   • ${s.khach} khách · ${s.gd} giao dịch (mục tiêu ~${txnCount}) · ${merges.rows[0]!.c} lần hợp nhất định danh (${mergeCount} ca)\n` +
    `   • Journeys: ${s.journeys} (welcome ${r1.enrolled} · cart ${r2.enrolled} · VIP ${r3.enrolled} · diamond ${r4.enrolled} · winback ${r5.enrolled} · at-risk ${r6.enrolled} · hotel ${r7.enrolled}) · ${s.runs} activation run · ${redeemed} lượt đổi điểm · ${carts} giỏ hàng mở/bỏ quên\n` +
    `   • ${s.users} user · ${s.keys} api-key · ${connsSeed.length} connection · 3 pipeline\n` +
    `   • Dự đoán: ${predRes.count} khách (nguồn: ${predRes.source})\n` +
    `   Đăng nhập: admin / Och@2026\n`,
  );
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
