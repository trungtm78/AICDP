import { safeFetch } from "../http-client.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { OutboundAdapter, OutboundMessage, DeliveryResult, HealthResult } from "./types.js";

// Adapter OUTBOUND Google Analytics 4 (Measurement Protocol, verify-free). POST event tới
// google-analytics.com/mp/collect?measurement_id&api_secret. Nếu payload có 'events' thì dùng
// nguyên; ngược lại bọc payload thành 1 event. client_id từ payload.client_id | occId | 'cdp'.
// GA4 trả 204 khi nhận. api_secret là secret (config.apiKey) -> đi trong query (đúng chuẩn GA4).

const COLLECT = "https://www.google-analytics.com/mp/collect";
const DEBUG = "https://www.google-analytics.com/debug/mp/collect";

function buildUrl(base: string, measurementId: string, apiSecret: string): string {
  const u = new URL(base);
  u.searchParams.set("measurement_id", measurementId);
  u.searchParams.set("api_secret", apiSecret);
  return u.toString();
}

function buildBody(msg: OutboundMessage): string {
  const p = msg.payload;
  const clientId = str(p["client_id"]) ?? str(msg.occId) ?? "cdp";
  const events = Array.isArray(p["events"])
    ? (p["events"] as unknown[])
    : [{ name: str(p["event"]) ?? "cdp_event", params: p["params"] ?? p }];
  return JSON.stringify({ client_id: clientId, events });
}

export const ga4OutboundAdapter: OutboundAdapter = {
  key: "dst_ga4",

  async deliver(config, msg: OutboundMessage, deps): Promise<DeliveryResult> {
    const measurementId = str(config["measurementId"]);
    const apiSecret = str(config["apiKey"]);
    if (!measurementId || !apiSecret) return { status: "failed", error: "Thiếu measurementId/apiKey." };
    const body = buildBody(msg);
    try {
      const res = await safeFetch(
        buildUrl(COLLECT, measurementId, apiSecret),
        fetchOpts({ method: "POST", headers: { "content-type": "application/json" }, body }, deps),
      );
      // GA4 chấp nhận -> 204 (không nội dung). 2xx = sent.
      return res.ok ? { status: "sent" } : { status: "failed", error: `HTTP ${res.status}` };
    } catch (e) {
      return { status: "failed", error: (e as Error).message };
    }
  },

  async healthCheck(config, deps): Promise<HealthResult> {
    const measurementId = str(config["measurementId"]);
    const apiSecret = str(config["apiKey"]);
    if (!measurementId || !apiSecret) return { ok: false, error: "Thiếu measurementId/apiKey." };
    const body = JSON.stringify({ client_id: "health", events: [{ name: "health_check" }] });
    try {
      // Endpoint /debug trả 200 + validationMessages -> xác nhận credential/định dạng.
      const res = await safeFetch(
        buildUrl(DEBUG, measurementId, apiSecret),
        fetchOpts({ method: "POST", headers: { "content-type": "application/json" }, body }, deps),
      );
      return res.status < 500 ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
};
