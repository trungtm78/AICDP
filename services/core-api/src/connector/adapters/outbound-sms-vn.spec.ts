import { describe, it, expect } from "vitest";
import { esmsOutboundAdapter } from "./outbound-esms.js";
import { vietguysOutboundAdapter } from "./outbound-vietguys.js";
import type { OutboundDeps, OutboundMessage } from "./types.js";

const lookup = async () => ["93.184.216.34"];
function fake(status: number, bodyText = "", cap?: { headers?: Record<string, string>; body?: string }) {
  return (async (_url: unknown, init: unknown) => {
    const i = init as { headers?: Record<string, string>; body?: string };
    if (cap) { cap.headers = i.headers; cap.body = i.body; }
    return { status, text: async () => bodyText } as unknown as Response;
  }) as typeof fetch;
}
const deps = (status: number, body = "", cap?: Parameters<typeof fake>[2]): OutboundDeps => ({ lookup, fetchImpl: fake(status, body, cap) });
const msg: OutboundMessage = { channel: "sms", recipient: "0900000001", payload: { content: "Xin chào" }, occId: "occ-1" };

describe("esmsOutboundAdapter", () => {
  const cfg = { apiKey: "AK", secretKey: "SK", brandname: "OCC" };
  it("CodeResult 100 -> sent + SMSID; body JSON có ApiKey/Phone/Content", async () => {
    const cap: { body?: string } = {};
    const r = await esmsOutboundAdapter.deliver(cfg, msg, deps(200, '{"CodeResult":"100","SMSID":"s1"}', cap));
    expect(r.status).toBe("sent");
    expect(r.providerMessageId).toBe("s1");
    expect(cap.body).toContain("0900000001");
    expect(cap.body).toContain("Xin ch"); // nội dung unicode
    expect(cap.body).toContain('"Brandname":"OCC"');
  });
  it("CodeResult != 100 -> failed", async () => {
    expect((await esmsOutboundAdapter.deliver(cfg, msg, deps(200, '{"CodeResult":"104"}'))).status).toBe("failed");
  });
  it("không recipient -> skipped_no_contact", async () => {
    expect((await esmsOutboundAdapter.deliver(cfg, { channel: "sms", payload: {} }, deps(200, '{"CodeResult":"100"}'))).status).toBe("skipped_no_contact");
  });
  it("thiếu credential -> failed", async () => {
    expect((await esmsOutboundAdapter.deliver({ apiKey: "AK" }, msg, deps(200))).status).toBe("failed");
  });
  it("HTTP 500 -> failed; healthCheck config đủ -> ok", async () => {
    expect((await esmsOutboundAdapter.deliver(cfg, msg, deps(500))).status).toBe("failed");
    expect((await esmsOutboundAdapter.healthCheck(cfg)).ok).toBe(true);
    expect((await esmsOutboundAdapter.healthCheck({ apiKey: "x" })).ok).toBe(false);
  });

  it("KHÔNG có content -> default TRUNG TÍNH, KHÔNG lộ tên audience nội bộ vào tin", async () => {
    const cap: { body?: string } = {};
    const noContent: OutboundMessage = { channel: "sms", recipient: "0900000001", payload: { audience: "VIP-churn-BIMAT", run_id: "r1" } };
    await esmsOutboundAdapter.deliver(cfg, noContent, deps(200, '{"CodeResult":"100"}', cap));
    expect(cap.body).not.toContain("VIP-churn-BIMAT");
    expect(cap.body).toContain("thông báo");
  });
});

describe("vietguysOutboundAdapter", () => {
  const cfg = { user: "u1", apiKey: "pw", brandname: "OCC" };
  it("error:0 -> sent; body form có u/pwd/from/phone/sms", async () => {
    const cap: { headers?: Record<string, string>; body?: string } = {};
    const r = await vietguysOutboundAdapter.deliver(cfg, msg, deps(200, '{"error":0,"msg_id":"v1"}', cap));
    expect(r.status).toBe("sent");
    expect(r.providerMessageId).toBe("v1");
    expect(cap.headers?.["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(cap.body).toContain("u=u1");
    expect(cap.body).toContain("from=OCC");
    expect(cap.body).toContain("phone=0900000001");
  });
  it("error != 0 -> failed", async () => {
    expect((await vietguysOutboundAdapter.deliver(cfg, msg, deps(200, '{"error":5}'))).status).toBe("failed");
  });
  it("không recipient -> skipped_no_contact", async () => {
    expect((await vietguysOutboundAdapter.deliver(cfg, { channel: "sms", payload: {} }, deps(200, '{"error":0}'))).status).toBe("skipped_no_contact");
  });
  it("thiếu credential -> failed; healthCheck", async () => {
    expect((await vietguysOutboundAdapter.deliver({ user: "u1" }, msg, deps(200))).status).toBe("failed");
    expect((await vietguysOutboundAdapter.healthCheck(cfg)).ok).toBe(true);
    expect((await vietguysOutboundAdapter.healthCheck({ user: "u1" })).ok).toBe(false);
  });
});
