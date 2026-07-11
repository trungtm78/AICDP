import net from "node:net";
import dns from "node:dns";
import { AppError } from "../http/errors.js";

// Chống SSRF cho MỌI URL/host do user nhập (webhook đích, reverse-ETL, warehouse, test-connection).
// Nguyên tắc: chỉ https (http khi dev bật), chặn IP nội bộ/metadata, resolve-then-pin chống
// DNS-rebinding, không userinfo. Trả về danh sách IP đã resolve để caller PIN khi fetch.

function blocked(message: string): AppError {
  return new AppError({
    code: "CONNECTOR_URL_BLOCKED",
    httpStatus: 400,
    message,
    why: "URL/host bị chặn bởi chính sách chống SSRF (không cho gọi tới hạ tầng nội bộ/metadata).",
    fix: "Dùng URL công khai dạng https tới hệ thống đích thật (không phải IP nội bộ/localhost).",
    retryable: false,
  });
}

function isPrivateIpv4(ip: string): boolean {
  const p = ip.split(".").map((x) => Number(x));
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true; // dạng lạ -> coi như không an toàn
  const [a, b] = p as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 192 && b === 0) return true; // 192.0.0/24 + 192.0.2/24 (test/reserved)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmark
  if (a >= 224) return true; // multicast/reserved 224-255 + broadcast
  return false;
}

/** Expand IPv6 (kể cả '::' nén và đuôi IPv4 dạng dotted) thành 8 hextet số. null nếu dạng lạ. */
export function expandIpv6(ipRaw: string): number[] | null {
  let s = ipRaw.toLowerCase();
  // Đuôi IPv4 dotted (::ffff:1.2.3.4) -> chuyển thành 2 hextet hex.
  const dot = /:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dot) {
    const p = dot[1]!.split(".").map((x) => Number(x));
    if (p.some((n) => n > 255)) return null;
    const h1 = (((p[0]! << 8) | p[1]!) >>> 0).toString(16);
    const h2 = (((p[2]! << 8) | p[3]!) >>> 0).toString(16);
    s = `${s.slice(0, dot.index)}:${h1}:${h2}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(":") : []) : [];
  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  const out: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    out.push(parseInt(g, 16));
  }
  return out;
}

/** Nếu IPv6 nhúng IPv4 (compat ::/96, mapped ::ffff:/96, translated ::ffff:0:0/96, NAT64
 *  64:ff9b::/96) -> trả IPv4 (last 32-bit). Fail-closed cho mọi biến thể IPv4-in-IPv6. */
function embeddedIpv4(hextets: number[]): string | null {
  const [a, b, c, d, e, f, g, h] = hextets as [number, number, number, number, number, number, number, number];
  const z4 = a === 0 && b === 0 && c === 0 && d === 0;
  const compat = z4 && e === 0 && f === 0;        // ::/96
  const mapped = z4 && e === 0 && f === 0xffff;   // ::ffff:/96
  const translated = z4 && e === 0xffff && f === 0; // ::ffff:0:0/96 (IPv4-translated)
  const nat64 = a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0; // 64:ff9b::/96
  if (compat || mapped || translated || nat64) {
    return `${(g >> 8) & 0xff}.${g & 0xff}.${(h >> 8) & 0xff}.${h & 0xff}`;
  }
  return null;
}

function isPrivateIpv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  const hextets = expandIpv6(ip);
  if (!hextets) return true; // dạng lạ -> không an toàn
  // IPv4 nhúng (mapped/compat/NAT64) — bắt CẢ dạng hex (::ffff:a9fe:a9fe) lẫn dotted.
  const v4 = embeddedIpv4(hextets);
  if (v4) return isPrivateIpv4(v4);
  const h0 = hextets[0]!;
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if (h0 === 0x0100 && hextets[1] === 0 && hextets[2] === 0 && hextets[3] === 0) return true; // 100::/64 discard
  return false;
}

/** true nếu IP thuộc dải nội bộ/loopback/link-local/CGNAT/metadata (KHÔNG được phép gọi ra). */
export function isPrivateIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return true; // không phải IP hợp lệ -> coi như không an toàn
}

export interface SsrfCheckOptions {
  /** Cho phép http (chỉ bật ở môi trường dev/test tường minh). Mặc định chỉ https. */
  allowHttp?: boolean;
  /** Hàm resolve host -> danh sách IP (tiêm để test; mặc định dùng dns.lookup all). */
  lookup?: (host: string) => Promise<string[]>;
}

async function defaultLookup(host: string): Promise<string[]> {
  const res = await dns.promises.lookup(host, { all: true });
  return res.map((r) => r.address);
}

const BLOCKED_HOST_SUFFIXES = [".internal", ".local", ".localhost"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

/**
 * Xác thực URL an toàn (chống SSRF). Ném AppError(CONNECTOR_URL_BLOCKED) nếu không an toàn.
 * Trả về { url, addresses }: addresses là IP đã resolve — caller NÊN pin fetch vào đó.
 */
export async function assertSafeUrl(
  rawUrl: string,
  opts: SsrfCheckOptions = {},
): Promise<{ url: URL; addresses: string[] }> {
  const allowHttp = opts.allowHttp ?? false;
  const lookup = opts.lookup ?? defaultLookup;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blocked(`URL không hợp lệ: ${rawUrl}`);
  }

  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) {
    throw blocked(`Scheme không cho phép: ${url.protocol} (chỉ https${allowHttp ? "/http-dev" : ""}).`);
  }
  if (url.username || url.password) {
    throw blocked("URL chứa userinfo (user:pass@…) — không cho phép (né phân tích host).");
  }

  let host = url.hostname;
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1); // IPv6 literal
  const lower = host.toLowerCase();

  if (BLOCKED_HOSTS.has(lower) || BLOCKED_HOST_SUFFIXES.some((s) => lower === s.slice(1) || lower.endsWith(s))) {
    throw blocked(`Host nội bộ bị chặn: ${host}.`);
  }

  // IP literal -> kiểm trực tiếp.
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw blocked(`IP nội bộ/metadata bị chặn: ${host}.`);
    return { url, addresses: [host] };
  }

  // Hostname -> resolve rồi kiểm MỌI IP (chống DNS-rebinding).
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw blocked(`Không resolve được host: ${host}.`);
  }
  if (addresses.length === 0) throw blocked(`Host không có bản ghi IP: ${host}.`);
  for (const ip of addresses) {
    if (isPrivateIp(ip)) throw blocked(`Host ${host} trỏ tới IP nội bộ ${ip} — chặn (SSRF/DNS-rebinding).`);
  }
  return { url, addresses };
}
