import { APIRequestContext } from "@playwright/test";

// Base core-api (bind 0.0.0.0 -> dùng 127.0.0.1 trên Windows để tránh stall IPv6 ::1).
export const API = "http://127.0.0.1:8071";

export const ADMIN = { username: "admin", password: "admin12345" };

// Hậu tố duy nhất theo lần chạy để né unique constraint DB dev (phone/pos_txn/username).
export const STAMP = Date.now();

export type Role =
  | "admin" | "data_steward" | "marketer" | "csr"
  | "analyst" | "compliance" | "executive" | "connector";

export async function login(req: APIRequestContext, username: string, password: string) {
  const res = await req.post(`${API}/v1/auth/login`, { data: { username, password } });
  return res;
}

export async function tokenFor(req: APIRequestContext, username: string, password: string): Promise<string> {
  const res = await login(req, username, password);
  if (!res.ok()) throw new Error(`Login ${username} thất bại: ${res.status()} ${await res.text()}`);
  return (await res.json()).data.token as string;
}

// Tạo user role qua admin (bỏ qua nếu đã tồn tại), trả token đăng nhập của user đó.
export async function ensureRoleToken(
  req: APIRequestContext,
  adminToken: string,
  role: Role,
): Promise<string> {
  const username = `uat_${role}`;
  const password = `Uat@${role}2026`;
  await req.post(`${API}/v1/auth/users`, {
    headers: auth(adminToken),
    data: { username, password, role, name: `UAT ${role}` },
  }); // 201 mới hoặc 409/400 nếu đã có -> kệ, vẫn login được
  return tokenFor(req, username, password);
}

export function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

// Ingest 1 đơn order_completed (service-to-service, KHÔNG có UI -> dùng API là interface hợp lệ).
export async function ingestOrder(
  req: APIRequestContext,
  token: string,
  opts: { brand: string; store: string; phone?: string; email?: string; posTxn: string; total: number },
) {
  const identifiers = [];
  if (opts.phone) identifiers.push({ type: "phone", value: opts.phone });
  if (opts.email) identifiers.push({ type: "email", value: opts.email });
  return req.post(`${API}/v1/ingest`, {
    headers: auth(token),
    data: {
      type: "order_completed",
      brand_id: opts.brand,
      store_id: opts.store,
      source: "pos",
      occ_timestamp: "2026-06-18T10:30:00+07:00",
      identifiers,
      properties: { pos_transaction_id: opts.posTxn, total: opts.total, items: [{ sku: "SKU-X", qty: 1 }] },
    },
  });
}

export async function balance(req: APIRequestContext, token: string, occId: string) {
  const res = await req.get(`${API}/v1/loyalty/balance?occId=${occId}`, { headers: auth(token) });
  return (await res.json()).data as { available: number; reserved: number };
}
