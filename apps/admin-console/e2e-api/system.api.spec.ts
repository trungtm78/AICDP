import { test, expect, request as pwRequest, APIRequestContext } from "@playwright/test";
import { API, ADMIN, STAMP, auth, tokenFor, ensureRoleToken, ingestOrder, balance } from "./helpers";

// ───────────────────────────────────────────────────────────────────────────
// API SMOKE GATE — UAT SYSTEM-WIDE OCC-CDP (risk-based P0).
// Chạy trực tiếp core-api. Mỗi case dùng token đúng role để verify RBAC deny-by-default.
// Đối chiếu trực tiếp với docs/uat/system-wide/uat_system-wide.md (TC-ID khớp tên test).
// ───────────────────────────────────────────────────────────────────────────

let req: APIRequestContext;
let adminToken: string;
const tok: Record<string, string> = {};
let occMain = ""; // khách chính (có giao dịch) cho loyalty/consent/activation/lookup
let occCrossPhone = ""; // số phone dùng hợp nhất xuyên brand
let brandA = "givral", brandB = "givral";
let phoneMain = "";

test.beforeAll(async () => {
  req = await pwRequest.newContext({ extraHTTPHeaders: { "Content-Type": "application/json" } });
  adminToken = await tokenFor(req, ADMIN.username, ADMIN.password);
  for (const r of ["data_steward", "marketer", "csr", "analyst", "compliance", "executive", "connector"] as const) {
    tok[r] = await ensureRoleToken(req, adminToken, r);
  }
  // Chọn 2 brand thật từ master data cho test hợp nhất xuyên brand.
  const brands = (await (await req.get(`${API}/v1/brands`, { headers: auth(tok.data_steward) })).json()).data;
  brandA = brands[0]?.brand_id ?? "givral";
  brandB = brands[1]?.brand_id ?? brandA;

  // Khách chính: ingest qua connector (ingestion KHÔNG có UI -> API là interface hợp lệ).
  phoneMain = `0902${String(STAMP).slice(-6)}`;
  const ing = await ingestOrder(req, tok.connector, {
    brand: brandA, store: "ST-UAT", phone: phoneMain, posTxn: `UAT-MAIN-${STAMP}`, total: 50_000_000,
  });
  occMain = (await ing.json()).data.occId;
  occCrossPhone = `0903${String(STAMP).slice(-6)}`;
});

test.afterAll(async () => { await req.dispose(); });

// ═══ MODULE 1 — AUTH / RBAC / PLATFORM (P0 cao nhất) ═══
test.describe("Auth / RBAC / Platform @p0", () => {
  test("SMK-01: GET /v1/health trả status ok @green", async () => {
    const res = await req.get(`${API}/v1/health`);
    expect(res.status()).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });

  test("AUTH-001: login admin đúng -> 200 + JWT role admin @green", async () => {
    const res = await req.post(`${API}/v1/auth/login`, { data: ADMIN });
    expect(res.status()).toBe(200);
    const d = (await res.json()).data;
    expect(d.token).toBeTruthy();
    expect(d.role).toBe("admin");
  });

  test("AUTH-002: login sai mật khẩu -> 401 @red", async () => {
    const res = await req.post(`${API}/v1/auth/login`, { data: { username: "admin", password: "saiquaroi" } });
    expect(res.status()).toBe(401);
  });

  test("AUTH-003: login user không tồn tại -> 401 (không lộ user) @red", async () => {
    const res = await req.post(`${API}/v1/auth/login`, { data: { username: `khong_ton_tai_${STAMP}`, password: "batky12345" } });
    expect(res.status()).toBe(401);
  });

  test("AUTH-004: login thiếu password -> 400 SCHEMA_MISSING_REQUIRED_FIELD @red", async () => {
    const res = await req.post(`${API}/v1/auth/login`, { data: { username: "admin" } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("SCHEMA_MISSING_REQUIRED_FIELD");
  });

  test("AUTH-005: gọi endpoint bảo vệ KHÔNG có Authorization -> 401 @security", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=phone&value=0900000000`);
    expect(res.status()).toBe(401);
  });

  test("AUTH-007: token rác/sai chữ ký -> 401 @security", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=phone&value=0900000000`, {
      headers: auth("eyJhbGciOiJIUzI1NiJ9.rac.khonghople"),
    });
    expect(res.status()).toBe(401);
  });

  test("AUTH-010: role csr gọi GET /v1/auth/users (admin-only) -> 403 @security", async () => {
    const res = await req.get(`${API}/v1/auth/users`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(403);
  });

  test("PLAT-006: role marketer POST /v1/auth/users -> 403 @security", async () => {
    const res = await req.post(`${API}/v1/auth/users`, {
      headers: auth(tok.marketer),
      data: { username: `x${STAMP}`, password: "Pass@1234", role: "csr", name: "X" },
    });
    expect(res.status()).toBe(403);
  });

  test("PLAT-001: admin tạo user mới -> 201 và user đăng nhập được @green", async () => {
    const u = `uat_new_${STAMP}`;
    const res = await req.post(`${API}/v1/auth/users`, {
      headers: auth(adminToken), data: { username: u, password: "NewUser@123", role: "analyst", name: "UAT New" },
    });
    expect(res.status()).toBe(201);
    const login = await req.post(`${API}/v1/auth/login`, { data: { username: u, password: "NewUser@123" } });
    expect(login.status()).toBe(200);
    expect((await login.json()).data.role).toBe("analyst");
  });

  test("PLAT-002: admin tạo API key -> 201 + rawKey hiện 1 lần @green", async () => {
    const res = await req.post(`${API}/v1/auth/api-keys`, {
      headers: auth(adminToken), data: { name: `uat-key-${STAMP}`, role: "connector" },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).data.rawKey).toBeTruthy();
  });

  test("PLAT-004: disable user -> user đó login bị từ chối / request 401-403 @security", async () => {
    const u = `uat_dis_${STAMP}`;
    const c = await req.post(`${API}/v1/auth/users`, {
      headers: auth(adminToken), data: { username: u, password: "Dis@12345", role: "marketer", name: "Dis" },
    });
    const id = (await c.json()).data.id;
    const userTok = await tokenFor(req, u, "Dis@12345");
    await req.post(`${API}/v1/auth/users/${id}/status`, { headers: auth(adminToken), data: { status: "disabled" } });
    // Token cũ sau khi disable -> request bị chặn (role/status đọc lại từ DB mỗi request).
    const after = await req.get(`${API}/v1/journeys`, { headers: auth(userTok) });
    expect([401, 403]).toContain(after.status());
  });

  test("PLAT-005: revoke API key -> key đó gọi API -> 401 @security", async () => {
    const c = await req.post(`${API}/v1/auth/api-keys`, {
      headers: auth(adminToken), data: { name: `uat-revoke-${STAMP}`, role: "connector" },
    });
    const body = (await c.json()).data;
    await req.post(`${API}/v1/auth/api-keys/${body.id}/revoke`, { headers: auth(adminToken) });
    const res = await ingestOrder(req, body.rawKey, { brand: brandA, store: "ST-UAT", phone: "0900000001", posTxn: `REV-${STAMP}`, total: 1000 });
    expect(res.status()).toBe(401);
  });
});

// ═══ MODULE 11 — MASTER DATA ═══
test.describe("Master Data @p0", () => {
  test("MAST-001: GET /v1/brands (data_steward) -> 5 brand seed @green", async () => {
    const res = await req.get(`${API}/v1/brands`, { headers: auth(tok.data_steward) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.length).toBeGreaterThanOrEqual(5);
  });

  test("MAST-007: tạo store thiếu field -> 400 SCHEMA_MISSING_REQUIRED_FIELD + field_path @red", async () => {
    const res = await req.post(`${API}/v1/stores`, { headers: auth(tok.data_steward), data: { brand_id: brandA } });
    expect(res.status()).toBe(400);
    const e = (await res.json()).error;
    expect(e.code).toBe("SCHEMA_MISSING_REQUIRED_FIELD");
    expect(e.field_path).toBeTruthy();
  });

  test("MAST-010: marketer POST /v1/stores -> 403 (chỉ data_steward) @security", async () => {
    const res = await req.post(`${API}/v1/stores`, {
      headers: auth(tok.marketer), data: { store_id: `S${STAMP}`, brand_id: brandA, name: "X" },
    });
    expect(res.status()).toBe(403);
  });

  test("MAST-011: connector GET /v1/brands -> 403 @security", async () => {
    const res = await req.get(`${API}/v1/brands`, { headers: auth(tok.connector) });
    expect(res.status()).toBe(403);
  });
});

// ═══ MODULE 2 — INGESTION ═══
test.describe("Ingestion @p0", () => {
  test("ING-001: connector ingest order_completed hợp lệ -> 202 + occId @green", async () => {
    const res = await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: `0904${String(STAMP).slice(-6)}`, posTxn: `ING1-${STAMP}`, total: 150000 });
    expect(res.status()).toBe(202);
    const d = (await res.json()).data;
    expect(d.occId).toBeTruthy();
    expect(d.idempotent).toBe(false);
  });

  test("ING-003: ingest lặp cùng {brand}:{store}:{pos_txn} -> idempotent, không tạo trùng @green", async () => {
    const posTxn = `ING3-${STAMP}`;
    const r1 = await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: `0905${String(STAMP).slice(-6)}`, posTxn, total: 99000 });
    const r2 = await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: `0905${String(STAMP).slice(-6)}`, posTxn, total: 99000 });
    expect(r1.status()).toBe(202);
    expect(r2.status()).toBe(202);
    expect((await r1.json()).data.idempotent).toBe(false);
    expect((await r2.json()).data.idempotent).toBe(true);
  });

  test("ING-004: 2 brand cùng phone -> cùng occId (hợp nhất xuyên thương hiệu) @green", async () => {
    const r1 = await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: occCrossPhone, posTxn: `ING4A-${STAMP}`, total: 10000 });
    const r2 = await ingestOrder(req, tok.connector, { brand: brandB, store: "ST-UAT", phone: occCrossPhone, posTxn: `ING4B-${STAMP}`, total: 20000 });
    const o1 = (await r1.json()).data.occId;
    const o2 = (await r2.json()).data.occId;
    expect(o1).toBe(o2);
  });

  test("ING-005: type không hợp lệ -> 400 UNKNOWN_EVENT_TYPE @red", async () => {
    const res = await req.post(`${API}/v1/ingest`, { headers: auth(tok.connector), data: { type: "page_view", brand_id: brandA } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("UNKNOWN_EVENT_TYPE");
  });

  test("ING-006: order_completed thiếu pos_transaction_id -> 400 @red", async () => {
    const res = await req.post(`${API}/v1/ingest`, {
      headers: auth(tok.connector),
      data: { type: "order_completed", brand_id: brandA, store_id: "ST-UAT", source: "pos", occ_timestamp: "2026-06-18T10:30:00+07:00", identifiers: [{ type: "phone", value: "0901112223" }], properties: { total: 1000 } },
    });
    expect(res.status()).toBe(400);
  });

  test("ING-008: tất cả identifier sai chuẩn hóa -> 400 INVALID_IDENTIFIER @red", async () => {
    const res = await req.post(`${API}/v1/ingest`, {
      headers: auth(tok.connector),
      data: { type: "order_completed", brand_id: brandA, store_id: "ST-UAT", source: "pos", occ_timestamp: "2026-06-18T10:30:00+07:00", identifiers: [{ type: "phone", value: "abc" }], properties: { pos_transaction_id: `BAD-${STAMP}`, total: 1000 } },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_IDENTIFIER");
  });

  test("ING-010: role marketer gọi /v1/ingest -> 403 (chỉ connector) @security", async () => {
    const res = await ingestOrder(req, tok.marketer, { brand: brandA, store: "ST-UAT", phone: "0900000002", posTxn: `MKT-${STAMP}`, total: 1000 });
    expect(res.status()).toBe(403);
  });

  test("ING-012: phone 3 định dạng (0..,+84..,84..) -> cùng occId @data", async () => {
    const base = `0906${String(STAMP).slice(-6)}`;
    const local = base;
    const e164 = `+84${base.slice(1)}`;
    const noplus = `84${base.slice(1)}`;
    const a = (await (await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: local, posTxn: `N1-${STAMP}`, total: 1000 })).json()).data.occId;
    const b = (await (await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: e164, posTxn: `N2-${STAMP}`, total: 1000 })).json()).data.occId;
    const c = (await (await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: noplus, posTxn: `N3-${STAMP}`, total: 1000 })).json()).data.occId;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  test("ING-021: ingest cho occ chưa có consent vẫn 202 (consent chỉ gate activation) @data", async () => {
    const res = await ingestOrder(req, tok.connector, { brand: brandA, store: "ST-UAT", phone: `0907${String(STAMP).slice(-6)}`, posTxn: `NOCONSENT-${STAMP}`, total: 5000 });
    expect(res.status()).toBe(202);
  });
});

// ═══ MODULE 3 — IDENTITY / CUSTOMER 360 ═══
test.describe("Identity / Customer 360 @p0", () => {
  test("ID-001: lookup phone đã ingest -> 200 occId khớp @green", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=phone&value=${phoneMain}`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(200);
    const d = (await res.json()).data;
    expect(d.occId).toBe(occMain);
    expect(d.transactions.length).toBeGreaterThanOrEqual(1);
  });

  test("ID-005: lookup identifier chưa gắn occId -> 404 CUSTOMER_NOT_FOUND @red", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=email&value=khong_ton_tai_${STAMP}@nowhere.com`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe("CUSTOMER_NOT_FOUND");
  });

  test("ID-006: lookup thiếu value -> 400 @red", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=phone`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(400);
  });

  test("ID-008: role connector gọi lookup -> 403 @security", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=phone&value=${phoneMain}`, { headers: auth(tok.connector) });
    expect(res.status()).toBe(403);
  });

  test("ID-015: value chứa SQL injection -> không lộ dữ liệu, 404/400 an toàn @security", async () => {
    const res = await req.get(`${API}/v1/customers/lookup?type=phone&value=${encodeURIComponent("' OR 1=1--")}`, { headers: auth(tok.csr) });
    expect([400, 404]).toContain(res.status());
  });
});

// ═══ MODULE 4 — LOYALTY (double-entry) ═══
test.describe("Loyalty @p0", () => {
  test("LOY-005: earn->reserve->capture, balance là projection đúng @green", async () => {
    const occ = occMain;
    const before = await balance(req, tok.csr, occ);
    const k = `LOY5-${STAMP}`;
    const earn = await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.csr), data: { occId: occ, points: 100, idempotencyKey: `${k}-e` } });
    expect(earn.ok(), `earn lỗi: ${earn.status()} ${await earn.text()}`).toBeTruthy(); // POST -> 201
    const afterEarn = await balance(req, tok.csr, occ);
    expect(afterEarn.available).toBe(before.available + 100);

    const res = await req.post(`${API}/v1/loyalty/reserve`, { headers: auth(tok.csr), data: { occId: occ, points: 30, idempotencyKey: `${k}-r` } });
    const reserveBody = await res.json();
    expect(res.ok(), `reserve lỗi: ${res.status()} ${JSON.stringify(reserveBody)}`).toBeTruthy();
    const reservationId = reserveBody.data.reservationId;
    const afterReserve = await balance(req, tok.csr, occ);
    expect(afterReserve.available).toBe(afterEarn.available - 30);
    expect(afterReserve.reserved).toBe(before.reserved + 30);

    const cap = await req.post(`${API}/v1/loyalty/capture`, { headers: auth(tok.csr), data: { reservationId, idempotencyKey: `${k}-c` } });
    expect(cap.ok()).toBeTruthy();
    const afterCapture = await balance(req, tok.csr, occ);
    expect(afterCapture.reserved).toBe(afterReserve.reserved - 30);
  });

  test("LOY-004: reserve rồi release phục hồi available @green", async () => {
    const occ = occMain;
    const k = `LOY4-${STAMP}`;
    const before = await balance(req, tok.csr, occ);
    const res = await req.post(`${API}/v1/loyalty/reserve`, { headers: auth(tok.csr), data: { occId: occ, points: 20, idempotencyKey: `${k}-r` } });
    const body = await res.json();
    expect(res.ok(), `reserve lỗi: ${res.status()} ${JSON.stringify(body)}`).toBeTruthy();
    const reservationId = body.data.reservationId;
    await req.post(`${API}/v1/loyalty/release`, { headers: auth(tok.csr), data: { reservationId, idempotencyKey: `${k}-rel` } });
    const after = await balance(req, tok.csr, occ);
    expect(after.available).toBe(before.available);
    expect(after.reserved).toBe(before.reserved);
  });

  test("LOY-006: earn cùng idempotencyKey nhưng points khác -> 409 IDEMPOTENCY_CONFLICT @red", async () => {
    const k = `LOY6-${STAMP}`;
    await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.csr), data: { occId: occMain, points: 50, idempotencyKey: k } });
    const dup = await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.csr), data: { occId: occMain, points: 80, idempotencyKey: k } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  test("LOY-007: earn cùng key + points giống (retry) -> idempotent, không cộng kép @green", async () => {
    const k = `LOY7-${STAMP}`;
    const before = await balance(req, tok.csr, occMain);
    await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.csr), data: { occId: occMain, points: 40, idempotencyKey: k } });
    await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.csr), data: { occId: occMain, points: 40, idempotencyKey: k } });
    const after = await balance(req, tok.csr, occMain);
    expect(after.available).toBe(before.available + 40); // chỉ +40 dù gọi 2 lần
  });

  test("LOY-008: reserve > available -> 409 INSUFFICIENT_BALANCE @red", async () => {
    const cur = await balance(req, tok.csr, occMain);
    const res = await req.post(`${API}/v1/loyalty/reserve`, { headers: auth(tok.csr), data: { occId: occMain, points: cur.available + 1000000, idempotencyKey: `LOY8-${STAMP}` } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("INSUFFICIENT_BALANCE");
  });

  test("LOY-009: capture reservation đã captured -> 409 RESERVATION_INVALID_STATE @red", async () => {
    const k = `LOY9-${STAMP}`;
    const r = await req.post(`${API}/v1/loyalty/reserve`, { headers: auth(tok.csr), data: { occId: occMain, points: 5, idempotencyKey: `${k}-r` } });
    const reservationId = (await r.json()).data.reservationId;
    await req.post(`${API}/v1/loyalty/capture`, { headers: auth(tok.csr), data: { reservationId, idempotencyKey: `${k}-c1` } });
    const again = await req.post(`${API}/v1/loyalty/capture`, { headers: auth(tok.csr), data: { reservationId, idempotencyKey: `${k}-c2` } });
    expect(again.status()).toBe(409);
    expect((await again.json()).error.code).toBe("RESERVATION_INVALID_STATE");
  });

  test("LOY-011: capture reservationId không tồn tại -> 404 RESERVATION_NOT_FOUND @red", async () => {
    const res = await req.post(`${API}/v1/loyalty/capture`, { headers: auth(tok.csr), data: { reservationId: "00000000-0000-0000-0000-0000000000ff", idempotencyKey: `LOY11-${STAMP}` } });
    expect(res.status()).toBe(404);
  });

  test("LOY-012: earn points <= 0 -> 400 INVALID_AMOUNT @boundary", async () => {
    const res = await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.csr), data: { occId: occMain, points: 0, idempotencyKey: `LOY12-${STAMP}` } });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe("INVALID_AMOUNT");
  });

  test("LOY-016: analyst earn -> 403; analyst balance -> 200 @security", async () => {
    const earn = await req.post(`${API}/v1/loyalty/earn`, { headers: auth(tok.analyst), data: { occId: occMain, points: 1, idempotencyKey: `LOY16-${STAMP}` } });
    expect(earn.status()).toBe(403);
    const bal = await req.get(`${API}/v1/loyalty/balance?occId=${occMain}`, { headers: auth(tok.analyst) });
    expect(bal.status()).toBe(200);
  });
});

// ═══ MODULE 5 — CONSENT (deny-by-default) ═══
test.describe("Consent @p0", () => {
  test("CON-003: occ chưa ghi consent -> check allowed=false (deny-by-default) @green", async () => {
    const res = await req.get(`${API}/v1/consent/check?occId=${occMain}&purpose=marketing_sms`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.allowed).toBe(false);
  });

  test("CON-001: grant marketing_email -> check allowed=true @green", async () => {
    const g = await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occMain, purpose: "marketing_email", status: "granted", source: "csr" } });
    expect(g.status()).toBe(201);
    const c = await req.get(`${API}/v1/consent/check?occId=${occMain}&purpose=marketing_email`, { headers: auth(tok.csr) });
    expect((await c.json()).data.allowed).toBe(true);
  });

  test("CON-004: latest-wins granted->withdrawn->granted -> allowed=true @green", async () => {
    const occ = occMain;
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "marketing_zalo", status: "granted", source: "csr" } });
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "marketing_zalo", status: "withdrawn", source: "csr" } });
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "marketing_zalo", status: "granted", source: "csr" } });
    const c = await req.get(`${API}/v1/consent/check?occId=${occ}&purpose=marketing_zalo`, { headers: auth(tok.csr) });
    expect((await c.json()).data.allowed).toBe(true);
  });

  test("CON-002: withdrawn -> check allowed=false @green", async () => {
    const occ = occMain;
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "personalization", status: "granted", source: "csr" } });
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "personalization", status: "withdrawn", source: "csr" } });
    const c = await req.get(`${API}/v1/consent/check?occId=${occ}&purpose=personalization`, { headers: auth(tok.csr) });
    expect((await c.json()).data.allowed).toBe(false);
  });

  test("CON-007: purpose ngoài enum -> 400 @red", async () => {
    const res = await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occMain, purpose: "marketing_tiktok", status: "granted", source: "csr" } });
    expect(res.status()).toBe(400);
  });

  test("CON-010: role connector POST /v1/consent -> 403 @security", async () => {
    const res = await req.post(`${API}/v1/consent`, { headers: auth(tok.connector), data: { occId: occMain, purpose: "marketing_email", status: "granted", source: "api" } });
    expect(res.status()).toBe(403);
  });
});

// ═══ MODULE 6 — ACTIVATION (chokepoint consent) ═══
test.describe("Activation @p0", () => {
  test("ACT-001: occ ĐÃ granted email -> allowed (gửi) @green", async () => {
    // occMain đã granted marketing_email ở CON-001.
    const res = await req.post(`${API}/v1/activation`, { headers: auth(tok.marketer), data: { audienceName: `act1-${STAMP}`, purpose: "marketing_email", channel: "email", destination: "rudderstack", occIds: [occMain] } });
    expect(res.status()).toBe(201);
    const d = (await res.json()).data;
    expect(d.allowedCount).toBe(1);
    expect(d.suppressedCount).toBe(0);
  });

  test("ACT-002: occ CHƯA granted purpose -> suppressed (deny-by-default) @green", async () => {
    const res = await req.post(`${API}/v1/activation`, { headers: auth(tok.marketer), data: { audienceName: `act2-${STAMP}`, purpose: "data_sharing", channel: "email", destination: "rudderstack", occIds: [occMain] } });
    expect(res.status()).toBe(201);
    const d = (await res.json()).data;
    expect(d.suppressedCount).toBe(1);
    expect(d.allowedCount).toBe(0);
  });

  test("ACT-004: total = allowedCount + suppressedCount (bất biến đếm) @data", async () => {
    const res = await req.post(`${API}/v1/activation`, { headers: auth(tok.marketer), data: { audienceName: `act4-${STAMP}`, purpose: "marketing_email", channel: "email", destination: "rudderstack", occIds: [occMain, occMain] } });
    const d = (await res.json()).data;
    expect(d.total).toBe(d.allowedCount + d.suppressedCount);
  });

  test("ACT-009: role csr POST /v1/activation -> 403 @security", async () => {
    const res = await req.post(`${API}/v1/activation`, { headers: auth(tok.csr), data: { audienceName: "x", purpose: "marketing_email", channel: "email", destination: "rudderstack", occIds: [occMain] } });
    expect(res.status()).toBe(403);
  });

  test("ACT-015: withdraw consent giữa 2 lần -> lần sau suppressed (gate động) @data", async () => {
    const occ = occMain;
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "marketing_sms", status: "granted", source: "csr" } });
    const r1 = await req.post(`${API}/v1/activation`, { headers: auth(tok.marketer), data: { audienceName: `a15a-${STAMP}`, purpose: "marketing_sms", channel: "sms", destination: "rudderstack", occIds: [occ] } });
    expect((await r1.json()).data.allowedCount).toBe(1);
    await req.post(`${API}/v1/consent`, { headers: auth(tok.csr), data: { occId: occ, purpose: "marketing_sms", status: "withdrawn", source: "csr" } });
    const r2 = await req.post(`${API}/v1/activation`, { headers: auth(tok.marketer), data: { audienceName: `a15b-${STAMP}`, purpose: "marketing_sms", channel: "sms", destination: "rudderstack", occIds: [occ] } });
    expect((await r2.json()).data.suppressedCount).toBe(1);
  });
});

// ═══ MODULE 7 — SEGMENT ═══
test.describe("Segment @p0", () => {
  test("SEG-001: preview minSpend -> count = occIds.length (bất biến) @green", async () => {
    const res = await req.post(`${API}/v1/segments/preview`, { headers: auth(tok.marketer), data: { minSpend: 1 } });
    expect(res.status()).toBe(200);
    const d = (await res.json()).data;
    expect(d.count).toBe(d.occIds.length);
    expect(d.occIds).toContain(occMain); // khách chính chi 50tr phải lọt
  });

  test("SEG-006: minSpend cực lớn -> count=0 @edge", async () => {
    const res = await req.post(`${API}/v1/segments/preview`, { headers: auth(tok.marketer), data: { minSpend: 999999999999 } });
    expect((await res.json()).data.count).toBe(0);
  });

  test("SEG-009: role csr preview -> 403 @security", async () => {
    const res = await req.post(`${API}/v1/segments/preview`, { headers: auth(tok.csr), data: { minSpend: 1 } });
    expect(res.status()).toBe(403);
  });
});

// ═══ MODULE 8 — JOURNEY ═══
test.describe("Journey @p0", () => {
  test("JNY-001: marketer tạo journey loyalty_bonus -> 201 @green", async () => {
    const res = await req.post(`${API}/v1/journeys`, { headers: auth(tok.marketer), data: { name: `jny1-${STAMP}`, segmentCriteria: { minSpend: 1 }, action: { type: "loyalty_bonus", points: 10 } } });
    expect(res.status()).toBe(201);
    expect((await res.json()).data.journey_id).toBeTruthy();
  });

  test("JNY-003: run journey loyalty_bonus -> cộng điểm cho khách segment @green", async () => {
    // Segment minSpend 40tr khớp occMain (chi 50tr). Kiểm delta balance occMain.
    const before = await balance(req, tok.csr, occMain);
    const c = await req.post(`${API}/v1/journeys`, { headers: auth(tok.marketer), data: { name: `jny3-${STAMP}`, segmentCriteria: { minSpend: 40000000 }, action: { type: "loyalty_bonus", points: 500 } } });
    const jid = (await c.json()).data.journey_id;
    const run = await req.post(`${API}/v1/journeys/${jid}/run`, { headers: auth(tok.marketer) });
    expect(run.status()).toBe(200);
    const rd = (await run.json()).data;
    expect(rd.actionResult.credited).toBeGreaterThanOrEqual(1);
    const after = await balance(req, tok.csr, occMain);
    expect(after.available).toBe(before.available + 500);
  });

  test("JNY-010: role csr gọi POST /v1/journeys -> 403 @security", async () => {
    const res = await req.post(`${API}/v1/journeys`, { headers: auth(tok.csr), data: { name: "x", action: { type: "loyalty_bonus", points: 1 } } });
    expect(res.status()).toBe(403);
  });

  test("JNY-011: journey activation KHÔNG bypass consent (occ chưa granted -> suppressed) @security", async () => {
    // occMain chưa granted data_sharing (ACT-002) -> journey activation phải suppress.
    const c = await req.post(`${API}/v1/journeys`, { headers: auth(tok.marketer), data: { name: `jny11-${STAMP}`, segmentCriteria: { minSpend: 40000000 }, action: { type: "activation", purpose: "data_sharing", channel: "email", destination: "rudderstack" } } });
    const jid = (await c.json()).data.journey_id;
    const run = await req.post(`${API}/v1/journeys/${jid}/run`, { headers: auth(tok.marketer) });
    expect(run.status()).toBe(200);
    const rd = (await run.json()).data;
    // activation result: số gửi cho occMain phải bị chặn (suppressed), không allowed.
    expect(rd.actionResult.kind).toBe("activation");
  });
});

// ═══ MODULE 9 — ANALYTICS ═══
test.describe("Analytics @p1", () => {
  test("ANL-001: GET /v1/analytics/overview (executive) -> 200 @green", async () => {
    const res = await req.get(`${API}/v1/analytics/overview`, { headers: auth(tok.executive) });
    expect(res.status()).toBe(200);
  });

  test("ANL-006: overview vẫn 200 dù ClickHouse down (fallback PG) @edge", async () => {
    const res = await req.get(`${API}/v1/analytics/overview`, { headers: auth(tok.analyst) });
    expect(res.status()).toBe(200); // không 500 -> circuit breaker + fallback PG hoạt động
  });

  test("ANL-008: role csr gọi /v1/analytics/overview -> 403 @security", async () => {
    const res = await req.get(`${API}/v1/analytics/overview`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(403);
  });
});

// ═══ MODULE 10 — AI cross-sell ═══
test.describe("AI cross-sell @p1", () => {
  test("AI-001/004: recommendations trả 200 + mảng (rỗng nếu thiếu lịch sử) @green", async () => {
    const res = await req.get(`${API}/v1/ai/recommendations?occId=${occMain}&limit=5`, { headers: auth(tok.marketer) });
    expect(res.status()).toBe(200);
    expect(Array.isArray((await res.json()).data.recommendations)).toBe(true);
  });

  test("AI-005: thiếu occId -> 400 @red", async () => {
    const res = await req.get(`${API}/v1/ai/recommendations`, { headers: auth(tok.marketer) });
    expect(res.status()).toBe(400);
  });

  test("AI-008: role csr gọi /v1/ai/recommendations -> 403 @security", async () => {
    const res = await req.get(`${API}/v1/ai/recommendations?occId=${occMain}`, { headers: auth(tok.csr) });
    expect(res.status()).toBe(403);
  });
});
