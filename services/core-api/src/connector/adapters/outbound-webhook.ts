import { safeFetch } from "../http-client.js";
import { hmacHex } from "../signing.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { OutboundAdapter, OutboundMessage, DeliveryResult, HealthResult } from "./types.js";

// Adapter OUTBOUND webhook (verify-free): POST payload JSON tới config.webhookUrl qua safeFetch
// (SSRF-safe + pin IP + timeout + strip CRLF). Tuỳ chọn ký HMAC body -> header X-OCC-Signature
// (đích xác thực nguồn). config.authHeader -> Authorization. KHÔNG lộ secret ra ngoài payload.

function headersFor(config: Record<string, unknown>, body: string): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json" };
  const auth = str(config["authHeader"]);
  if (auth) h["authorization"] = auth;
  const signingSecret = str(config["signingSecret"]);
  if (signingSecret) h["x-occ-signature"] = hmacHex(signingSecret, body, "sha256");
  return h;
}

export const webhookOutboundAdapter: OutboundAdapter = {
  key: "dst_webhook",

  async deliver(config, msg: OutboundMessage, deps): Promise<DeliveryResult> {
    // URL đích LẤY TỪ config (không mượn msg.recipient — recipient là người nhận, không phải URL).
    const url = str(config["webhookUrl"]);
    if (!url) return { status: "failed", error: "Thiếu webhookUrl." };
    const body = JSON.stringify({ channel: msg.channel, occId: msg.occId ?? null, payload: msg.payload });
    try {
      const res = await safeFetch(url, fetchOpts({ method: "POST", headers: headersFor(config, body), body }, deps));
      return res.ok ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}` };
    } catch (e) {
      return { status: "failed", error: (e as Error).message };
    }
  },

  async healthCheck(config, deps): Promise<HealthResult> {
    const url = str(config["webhookUrl"]);
    if (!url) return { ok: false, error: "Thiếu webhookUrl." };
    const body = JSON.stringify({ type: "health_check" });
    try {
      const res = await safeFetch(url, fetchOpts({ method: "POST", headers: headersFor(config, body), body }, deps));
      // Endpoint phản hồi < 500 = coi như tiếp cận được (nhiều webhook trả 4xx cho ping lạ).
      return res.status < 500 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
