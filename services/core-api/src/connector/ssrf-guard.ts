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

function isPrivateIpv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  // IPv4-mapped/embedded (::ffff:a.b.c.d) -> kiểm phần IPv4
  if (ip.includes(".")) {
    const v4 = ip.slice(ip.lastIndexOf(":") + 1);
    if (net.isIPv4(v4)) return isPrivateIpv4(v4);
  }
  const firstGroup = ip.startsWith("::") ? "0" : (ip.split(":")[0] || "0");
  const h = parseInt(firstGroup, 16);
  if (Number.isNaN(h)) return true; // dạng lạ -> không an toàn
  if ((h & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((h & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
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
