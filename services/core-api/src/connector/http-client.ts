import net from "node:net";
import { Agent } from "undici";
import { assertSafeUrl } from "./ssrf-guard.js";

// Client HTTP an toàn cho MỌI call ra hệ thống ngoài do user cấu hình. Bắt buộc qua assertSafeUrl
// (chống SSRF) + PIN IP đã resolve (chống DNS-rebinding TOCTOU) + timeout + redirect thủ công +
// strip CRLF trong header (chống header injection). Có thể tiêm fetchImpl để test không cần mạng.

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  allowHttp?: boolean;
  lookup?: (host: string) => Promise<string[]>; // tiêm cho assertSafeUrl (test)
  fetchImpl?: typeof fetch;                       // tiêm cho test (bỏ qua pin undici)
}

export interface SafeResponse {
  status: number;
  ok: boolean;
  body: string;
}

type PinCb = (err: Error | null, address: string, family: number) => void;

/** Lookup PIN: luôn trả IP đã kiểm (bỏ qua DNS runtime) — chống DNS-rebinding TOCTOU. */
export function makePinLookup(ip: string, family: number) {
  return (_hostname: string, _options: unknown, cb: PinCb): void => cb(null, ip, family);
}

/** Dispatcher undici pin kết nối vào IP đã kiểm. undefined nếu không có địa chỉ. */
export function buildPinnedDispatcher(addresses: string[]): Agent | undefined {
  const ip = addresses[0];
  if (!ip) return undefined;
  return new Agent({ connect: { lookup: makePinLookup(ip, net.isIP(ip)) } });
}

/** Bỏ CR/LF khỏi giá trị header (chống header/response splitting). */
function sanitizeHeaders(h: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = String(v).replace(/[\r\n]/g, "");
  }
  return out;
}

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const check: { allowHttp?: boolean; lookup?: (host: string) => Promise<string[]> } = {};
  if (opts.allowHttp !== undefined) check.allowHttp = opts.allowHttp;
  if (opts.lookup !== undefined) check.lookup = opts.lookup;
  const { url, addresses } = await assertSafeUrl(rawUrl, check);

  const f = opts.fetchImpl ?? fetch;
  const init: RequestInit = {
    method: opts.method ?? "GET",
    headers: sanitizeHeaders(opts.headers),
    redirect: "manual", // KHÔNG tự follow redirect (né redirect về nội bộ)
    signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
  };
  if (opts.body !== undefined) init.body = opts.body;

  // Pin kết nối vào IP đã kiểm (chỉ khi dùng fetch thật; test tiêm fetchImpl thì bỏ qua).
  if (!opts.fetchImpl) {
    const dispatcher = buildPinnedDispatcher(addresses);
    if (dispatcher) (init as { dispatcher?: unknown }).dispatcher = dispatcher;
  }

  const res = await f(url, init);
  const body = await res.text();
  return { status: res.status, ok: res.status >= 200 && res.status < 300, body };
}
