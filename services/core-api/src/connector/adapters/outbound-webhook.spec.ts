import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { webhookOutboundAdapter } from "./outbound-webhook.js";
import type { OutboundDeps, OutboundMessage } from "./types.js";

// Test adapter webhook KHÔNG cần mạng: tiêm lookup (bỏ DNS, IP công khai qua SSRF guard) + fetchImpl.
const PUB_IP = "93.184.216.34";
const lookup = async () => [PUB_IP];

function fakeFetch(status: number, capture?: { headers?: Record<string, string>; url?: string; body?: string }) {
  return (async (url: unknown, init: unknown) => {
    const i = init as { headers?: Record<string, string>; body?: string };
    if (capture) { capture.headers = i.headers; capture.url = String(url); capture.body = i.body; }
    return { status, text: async () => "resp" } as unknown as Response;
  }) as typeof fetch;
}
const deps = (status: number, cap?: Parameters<typeof fakeFetch>[1]): OutboundDeps => ({ fetchImpl: fakeFetch(status, cap), lookup });

const msg: OutboundMessage = { channel: "webhook", payload: { hello: "world" }, occId: "occ-1" };
const cfg = { webhookUrl: "https://hooks.example.com/ingest" };

describe("webhookOutboundAdapter.deliver", () => {
  it("HTTP 2xx -> sent, POST đúng URL + body chứa payload", async () => {
    const cap: { headers?: Record<string, string>; url?: string; body?: string } = {};
    const r = await webhookOutboundAdapter.deliver(cfg, msg, deps(200, cap));
    expect(r.status).toBe("sent");
    expect(cap.url).toBe("https://hooks.example.com/ingest");
    expect(cap.body).toContain("world");
    expect(cap.headers?.["content-type"]).toBe("application/json");
  });

  it("HTTP 5xx -> failed + error HTTP status", async () => {
    const r = await webhookOutboundAdapter.deliver(cfg, msg, deps(502));
    expect(r.status).toBe("failed");
    expect(r.error).toContain("502");
  });

  it("fetch ném (mạng lỗi) -> failed, không throw", async () => {
    const bad: OutboundDeps = { lookup, fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as typeof fetch };
    const r = await webhookOutboundAdapter.deliver(cfg, msg, bad);
    expect(r.status).toBe("failed");
    expect(r.error).toContain("ECONNREFUSED");
  });

  it("thiếu webhookUrl -> failed (KHÔNG mượn recipient làm URL)", async () => {
    expect((await webhookOutboundAdapter.deliver({}, msg, deps(200))).status).toBe("failed");
    // recipient là người nhận, KHÔNG được dùng làm URL đích -> vẫn failed dù có recipient.
    const withRecip: OutboundMessage = { ...msg, recipient: "https://hooks.example.com/r" };
    expect((await webhookOutboundAdapter.deliver({}, withRecip, deps(200))).status).toBe("failed");
  });

  it("signingSecret -> ký HMAC-SHA256 body vào header X-OCC-Signature", async () => {
    const cap: { headers?: Record<string, string>; body?: string } = {};
    await webhookOutboundAdapter.deliver({ ...cfg, signingSecret: "S3CRET" }, msg, deps(200, cap));
    const expected = createHmac("sha256", "S3CRET").update(cap.body!, "utf8").digest("hex");
    expect(cap.headers?.["x-occ-signature"]).toBe(expected);
  });

  it("authHeader -> Authorization header", async () => {
    const cap: { headers?: Record<string, string> } = {};
    await webhookOutboundAdapter.deliver({ ...cfg, authHeader: "Bearer tok" }, msg, deps(200, cap));
    expect(cap.headers?.["authorization"]).toBe("Bearer tok");
  });
});

describe("webhookOutboundAdapter.healthCheck", () => {
  it("< 500 -> ok", async () => {
    expect((await webhookOutboundAdapter.healthCheck(cfg, deps(200))).ok).toBe(true);
    expect((await webhookOutboundAdapter.healthCheck(cfg, deps(404))).ok).toBe(true);
  });
  it(">= 500 -> không ok", async () => {
    expect((await webhookOutboundAdapter.healthCheck(cfg, deps(503))).ok).toBe(false);
  });
  it("thiếu webhookUrl -> không ok", async () => {
    expect((await webhookOutboundAdapter.healthCheck({}, deps(200))).ok).toBe(false);
  });
  it("fetch ném -> không ok", async () => {
    const bad: OutboundDeps = { lookup, fetchImpl: (async () => { throw new Error("timeout"); }) as typeof fetch };
    expect((await webhookOutboundAdapter.healthCheck(cfg, bad)).ok).toBe(false);
  });
});
