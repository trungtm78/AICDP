import { describe, it, expect } from "vitest";
import { AppError } from "../http/errors.js";
import { assertSafeUrl, isPrivateIp } from "./ssrf-guard.js";

// Lookup giả (không đụng DNS thật) — map hostname -> danh sách IP đã "resolve".
const fakeLookup = (map: Record<string, string[]>) => async (host: string): Promise<string[]> => {
  const ips = map[host];
  if (!ips) throw new Error(`ENOTFOUND ${host}`);
  return ips;
};

describe("ssrf-guard · isPrivateIp", () => {
  it("nhận diện IPv4 private/loopback/link-local/CGNAT", () => {
    for (const ip of ["10.0.0.1", "172.16.5.4", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("cho phép IPv4 public", () => {
    for (const ip of ["93.184.216.34", "8.8.8.8", "1.1.1.1"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
  it("nhận diện IPv6 loopback/ULA/link-local + IPv4-mapped private", () => {
    for (const ip of ["::1", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:169.254.169.254", "::"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("cho phép IPv6 public", () => {
    expect(isPrivateIp("2606:4700:4700::1111")).toBe(false);
  });
  it("CHẶN IPv4-mapped IPv6 dạng HEX-group (lỗ hổng SSRF P0)", () => {
    // ::ffff:a9fe:a9fe = 169.254.169.254 (metadata); ::ffff:7f00:1 = 127.0.0.1; ::ffff:0a00:0001 = 10.0.0.1
    for (const ip of [
      "::ffff:a9fe:a9fe", "::ffff:7f00:1", "::ffff:0a00:0001", "64:ff9b::a9fe:a9fe", "::ffff:c0a8:0101",
      "::ffff:0:a9fe:a9fe", // IPv4-translated ::ffff:0:0/96 -> 169.254.169.254
      "fec0::1",            // site-local deprecated
      "100::1",             // discard-only
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("mapped IPv4 PUBLIC vẫn cho phép (::ffff:8.8.8.8)", () => {
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false);
    expect(isPrivateIp("::ffff:0808:0808")).toBe(false);
  });
  it("chặn dải reserved/multicast/test-net IPv4", () => {
    for (const ip of ["224.0.0.1", "240.0.0.1", "192.0.2.10", "198.18.0.1", "255.255.255.255"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("chuỗi không phải IP -> coi như không an toàn", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
    expect(isPrivateIp("999.1.1.1")).toBe(true);
  });
});

describe("ssrf-guard · assertSafeUrl", () => {
  const lookup = fakeLookup({
    "example.com": ["93.184.216.34"],
    "evil-rebind.com": ["10.0.0.5"], // DNS-rebinding: tên public nhưng trỏ nội bộ
    "mixed.com": ["93.184.216.34", "127.0.0.1"], // 1 public + 1 private -> phải chặn
  });

  it("chấp nhận https public + trả IP đã resolve để pin", async () => {
    const r = await assertSafeUrl("https://example.com/webhook", { lookup });
    expect(r.url.hostname).toBe("example.com");
    expect(r.addresses).toContain("93.184.216.34");
  });

  it("từ chối http mặc định; cho phép khi allowHttp", async () => {
    await expect(assertSafeUrl("http://example.com", { lookup })).rejects.toBeInstanceOf(AppError);
    const r = await assertSafeUrl("http://example.com", { lookup, allowHttp: true });
    expect(r.url.protocol).toBe("http:");
  });

  it("từ chối URL không hợp lệ + scheme lạ (file/ftp/gopher)", async () => {
    for (const u of ["not-a-url", "ftp://example.com", "file:///etc/passwd", "gopher://x"]) {
      await expect(assertSafeUrl(u, { lookup })).rejects.toBeInstanceOf(AppError);
    }
  });

  it("chặn IP literal nội bộ (metadata/loopback/private + IPv6-mapped hex)", async () => {
    for (const u of [
      "https://169.254.169.254/latest/meta-data", "https://127.0.0.1:8071", "https://10.0.0.1",
      "https://[::1]:6379", "https://[::ffff:a9fe:a9fe]/latest/meta-data", "https://[::ffff:7f00:1]:8071",
    ]) {
      await expect(assertSafeUrl(u, { lookup })).rejects.toBeInstanceOf(AppError);
    }
  });

  it("chặn hostname nội bộ không cần DNS (localhost/.internal/.local/metadata)", async () => {
    for (const u of ["https://localhost", "https://core-api.internal", "https://db.local", "https://metadata.google.internal"]) {
      await expect(assertSafeUrl(u, { lookup })).rejects.toBeInstanceOf(AppError);
    }
  });

  it("chặn DNS-rebinding: hostname public nhưng resolve ra IP nội bộ", async () => {
    await expect(assertSafeUrl("https://evil-rebind.com", { lookup })).rejects.toBeInstanceOf(AppError);
  });

  it("chặn khi BẤT KỲ IP resolve nào là nội bộ (mixed)", async () => {
    await expect(assertSafeUrl("https://mixed.com", { lookup })).rejects.toBeInstanceOf(AppError);
  });

  it("chặn userinfo trong URL (user:pass@host — né phân tích host)", async () => {
    await expect(assertSafeUrl("https://user:pass@example.com", { lookup })).rejects.toBeInstanceOf(AppError);
  });

  it("lỗi ném ra là AppError code CONNECTOR_URL_BLOCKED", async () => {
    await expect(assertSafeUrl("https://127.0.0.1", { lookup })).rejects.toMatchObject({ code: "CONNECTOR_URL_BLOCKED" });
  });
});
