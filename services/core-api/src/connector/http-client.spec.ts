import { describe, it, expect } from "vitest";
import { AppError } from "../http/errors.js";
import { safeFetch, makePinLookup, buildPinnedDispatcher } from "./http-client.js";

const lookup = async (host: string): Promise<string[]> => {
  if (host === "api.test") return ["93.184.216.34"];
  throw new Error(`ENOTFOUND ${host}`);
};

function mockFetch(status: number, body: string) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: URL | string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return { status, text: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("http-client · safeFetch", () => {
  it("gọi được URL public https, trả status/ok/body chuẩn hoá", async () => {
    const { impl, calls } = mockFetch(200, "hello");
    const r = await safeFetch("https://api.test/hook", { fetchImpl: impl, lookup, method: "POST", body: "{}" });
    expect(r).toEqual({ status: 200, ok: true, body: "hello" });
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.redirect).toBe("manual");
  });

  it("status ngoài 2xx -> ok=false (vẫn trả body)", async () => {
    const { impl } = mockFetch(500, "err");
    const r = await safeFetch("https://api.test", { fetchImpl: impl, lookup });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
  });

  it("strip CR/LF khỏi header (chống header injection)", async () => {
    const { impl, calls } = mockFetch(200, "");
    await safeFetch("https://api.test", {
      fetchImpl: impl, lookup,
      headers: { "X-Test": "a\r\nX-Inject: evil" },
    });
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h["X-Test"]).toBe("aX-Inject: evil");
    expect(h["X-Test"]).not.toContain("\n");
  });

  it("CHẶN URL nội bộ (SSRF) trước khi fetch — fetchImpl KHÔNG được gọi", async () => {
    const { impl, calls } = mockFetch(200, "");
    await expect(safeFetch("https://127.0.0.1:8071/x", { fetchImpl: impl, lookup })).rejects.toBeInstanceOf(AppError);
    await expect(safeFetch("https://169.254.169.254/", { fetchImpl: impl, lookup })).rejects.toBeInstanceOf(AppError);
    expect(calls).toHaveLength(0);
  });

  it("CHẶN DNS-rebinding: host public resolve ra IP nội bộ", async () => {
    const { impl, calls } = mockFetch(200, "");
    const evilLookup = async () => ["10.0.0.9"];
    await expect(safeFetch("https://evil.test", { fetchImpl: impl, lookup: evilLookup })).rejects.toBeInstanceOf(AppError);
    expect(calls).toHaveLength(0);
  });
});

describe("http-client · pin IP (chống DNS-rebinding TOCTOU)", () => {
  it("makePinLookup gọi callback với IP đã kiểm (bỏ qua DNS)", () => {
    let got: { a: string; f: number } | null = null;
    makePinLookup("1.2.3.4", 4)("bất-kỳ-host", {}, (_e, a, f) => { got = { a, f }; });
    expect(got).toEqual({ a: "1.2.3.4", f: 4 });
  });
  it("buildPinnedDispatcher: có IP -> Agent; rỗng -> undefined", () => {
    expect(buildPinnedDispatcher(["93.184.216.34"])).toBeDefined();
    expect(buildPinnedDispatcher([])).toBeUndefined();
  });
});
