import { describe, it, expect } from "vitest";
import { ga4OutboundAdapter } from "./outbound-ga4.js";
import { zaloZnsOutboundAdapter } from "./outbound-zalo-zns.js";
import type { OutboundDeps, OutboundMessage } from "./types.js";

const lookup = async () => ["93.184.216.34"];
function fake(status: number, bodyText = "", cap?: { url?: string; headers?: Record<string, string>; body?: string }) {
  return (async (url: unknown, init: unknown) => {
    const i = init as { headers?: Record<string, string>; body?: string };
    if (cap) { cap.url = String(url); cap.headers = i.headers; cap.body = i.body; }
    return { status, text: async () => bodyText } as unknown as Response;
  }) as typeof fetch;
}
const deps = (status: number, body = "", cap?: Parameters<typeof fake>[2]): OutboundDeps => ({ lookup, fetchImpl: fake(status, body, cap) });

describe("ga4OutboundAdapter", () => {
  const cfg = { measurementId: "G-XXX", apiKey: "secret123" };
  it("204 -> sent; URL kèm measurement_id + api_secret; body có client_id/events", async () => {
    const cap: { url?: string; body?: string } = {};
    const msg: OutboundMessage = { channel: "analytics", payload: { event: "purchase", params: { value: 100 } }, occId: "occ-9" };
    const r = await ga4OutboundAdapter.deliver(cfg, msg, deps(204, "", cap));
    expect(r.status).toBe("sent");
    expect(cap.url).toContain("measurement_id=G-XXX");
    expect(cap.url).toContain("api_secret=secret123");
    expect(cap.body).toContain("occ-9"); // client_id fallback = occId
    expect(cap.body).toContain("purchase");
  });

  it("payload có mảng events -> dùng nguyên", async () => {
    const cap: { body?: string } = {};
    const msg: OutboundMessage = { channel: "analytics", payload: { client_id: "c1", events: [{ name: "a" }, { name: "b" }] } };
    await ga4OutboundAdapter.deliver(cfg, msg, deps(204, "", cap));
    expect(cap.body).toContain('"client_id":"c1"');
    expect(cap.body).toContain('"name":"a"');
  });

  it("thiếu measurementId/apiKey -> failed", async () => {
    expect((await ga4OutboundAdapter.deliver({}, { channel: "x", payload: {} }, deps(204))).status).toBe("failed");
  });

  it("HTTP 500 -> failed", async () => {
    expect((await ga4OutboundAdapter.deliver(cfg, { channel: "x", payload: {} }, deps(500))).status).toBe("failed");
  });

  it("healthCheck debug 200 -> ok; thiếu config -> không ok", async () => {
    expect((await ga4OutboundAdapter.healthCheck(cfg, deps(200))).ok).toBe(true);
    expect((await ga4OutboundAdapter.healthCheck({}, deps(200))).ok).toBe(false);
  });
});

describe("zaloZnsOutboundAdapter", () => {
  const cfg = { apiKey: "ztoken", templateId: "tpl-1" };
  const msg: OutboundMessage = { channel: "zalo_zns", recipient: "0900000001", payload: { template_data: { name: "A" } }, occId: "occ-2" };

  it("error:0 -> sent + providerMessageId; header access_token + body phone/template_id", async () => {
    const cap: { headers?: Record<string, string>; body?: string } = {};
    const r = await zaloZnsOutboundAdapter.deliver(cfg, msg, deps(200, '{"error":0,"data":{"msg_id":"m9"}}', cap));
    expect(r.status).toBe("sent");
    expect(r.providerMessageId).toBe("m9");
    expect(cap.headers?.["access_token"]).toBe("ztoken");
    expect(cap.body).toContain("0900000001");
    expect(cap.body).toContain("tpl-1");
  });

  it("error != 0 -> failed kèm message", async () => {
    const r = await zaloZnsOutboundAdapter.deliver(cfg, msg, deps(200, '{"error":-124,"message":"token expired"}'));
    expect(r.status).toBe("failed");
    expect(r.error).toContain("token expired");
  });

  it("không có recipient -> skipped_no_contact", async () => {
    const r = await zaloZnsOutboundAdapter.deliver(cfg, { channel: "zalo_zns", payload: {} }, deps(200, '{"error":0}'));
    expect(r.status).toBe("skipped_no_contact");
  });

  it("thiếu access_token/templateId -> failed", async () => {
    expect((await zaloZnsOutboundAdapter.deliver({}, msg, deps(200, '{"error":0}'))).status).toBe("failed");
  });

  it("HTTP 500 -> failed", async () => {
    expect((await zaloZnsOutboundAdapter.deliver(cfg, msg, deps(500))).status).toBe("failed");
  });

  it("healthCheck: config đủ -> ok; thiếu -> không ok", async () => {
    expect((await zaloZnsOutboundAdapter.healthCheck(cfg)).ok).toBe(true);
    expect((await zaloZnsOutboundAdapter.healthCheck({ apiKey: "x" })).ok).toBe(false);
  });
});
