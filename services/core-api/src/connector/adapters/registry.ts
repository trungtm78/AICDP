import type { OutboundAdapter, InboundPullAdapter } from "./types.js";

// Registry adapter: map connectorKey -> adapter. Nhãn install của connector suy từ ĐÂY
// (có adapter -> 'ready'; không -> 'planned'). Adapter tự đăng ký lúc import module.

const outbound = new Map<string, OutboundAdapter>();
const inboundPull = new Map<string, InboundPullAdapter>();

export function registerOutbound(a: OutboundAdapter): void {
  outbound.set(a.key, a);
}
export function getOutbound(key: string): OutboundAdapter | undefined {
  return outbound.get(key);
}
export function hasOutbound(key: string): boolean {
  return outbound.has(key);
}
export function listOutboundKeys(): string[] {
  return [...outbound.keys()];
}

export function registerInboundPull(a: InboundPullAdapter): void {
  inboundPull.set(a.key, a);
}
export function getInboundPull(key: string): InboundPullAdapter | undefined {
  return inboundPull.get(key);
}
export function hasInboundPull(key: string): boolean {
  return inboundPull.has(key);
}

/** Nhãn cài đặt: 'ready' nếu có adapter (outbound hoặc inbound-pull); ngược lại 'planned'. */
export function installStatus(key: string): "ready" | "planned" {
  return outbound.has(key) || inboundPull.has(key) ? "ready" : "planned";
}
