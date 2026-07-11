import { describe, it, expect } from "vitest";
import {
  registerOutbound, getOutbound, hasOutbound, listOutboundKeys,
  registerInboundPull, getInboundPull, hasInboundPull, installStatus,
} from "./registry.js";
import type { OutboundAdapter, InboundPullAdapter } from "./types.js";

const fakeOut: OutboundAdapter = {
  key: "test_out_xyz",
  deliver: async () => ({ status: "sent" }),
  healthCheck: async () => ({ ok: true }),
};
const fakeIn: InboundPullAdapter = {
  key: "test_in_xyz",
  pull: async () => ({ events: [], nextCursor: null }),
};

describe("registry", () => {
  it("đăng ký + lấy outbound adapter", () => {
    registerOutbound(fakeOut);
    expect(hasOutbound("test_out_xyz")).toBe(true);
    expect(getOutbound("test_out_xyz")).toBe(fakeOut);
    expect(listOutboundKeys()).toContain("test_out_xyz");
  });

  it("đăng ký + lấy inbound-pull adapter", () => {
    registerInboundPull(fakeIn);
    expect(hasInboundPull("test_in_xyz")).toBe(true);
    expect(getInboundPull("test_in_xyz")).toBe(fakeIn);
  });

  it("key lạ -> undefined", () => {
    expect(getOutbound("khong-ton-tai")).toBeUndefined();
  });

  it("installStatus: có adapter -> ready; không -> planned", () => {
    registerOutbound(fakeOut);
    registerInboundPull(fakeIn);
    expect(installStatus("test_out_xyz")).toBe("ready");
    expect(installStatus("test_in_xyz")).toBe("ready");
    expect(installStatus("dst_meta_ads")).toBe("planned");
  });
});
