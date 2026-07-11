import { safeFetch } from "../http-client.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { OutboundAdapter, OutboundMessage, DeliveryResult, HealthResult } from "./types.js";

// Adapter OUTBOUND VietGuys (SMS brandname VN). POST form-urlencoded tới cloudsms.vietguys.biz.
// config: user, apiKey(password secret), brandname(from). recipient=phone. json=1 -> trả {error:0}.
// Đối chiếu endpoint/tham số với tài liệu VietGuys của merchant trước production.

const VG_URL = "https://cloudsms.vietguys.biz:4438/api/index.php";

function form(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

export const vietguysOutboundAdapter: OutboundAdapter = {
  key: "dst_vietguys",

  async deliver(config, msg: OutboundMessage, deps): Promise<DeliveryResult> {
    const user = str(config["user"]);
    const pwd = str(config["apiKey"]);
    const from = str(config["brandname"]);
    if (!user || !pwd || !from) return { status: "failed", error: "Thiếu user/password/brandname." };
    const phone = str(msg.recipient) ?? str(msg.payload["phone"]);
    if (!phone) return { status: "skipped_no_contact", error: "Không có số điện thoại." };
    const sms = str(msg.payload["content"]) ?? str(msg.payload["message"]) ?? `OCC-CDP: ${str(msg.payload["audience"]) ?? "thông báo"}`;

    const body = form({ u: user, pwd, from, phone, sms, json: "1" });
    try {
      const res = await safeFetch(VG_URL, fetchOpts({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }, deps));
      if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` };
      let parsed: { error?: unknown; msg_id?: unknown } = {};
      try { parsed = JSON.parse(res.body) as typeof parsed; } catch { /* không JSON */ }
      if (Number(parsed.error) === 0) {
        return { status: "sent", ...(parsed.msg_id != null ? { providerMessageId: String(parsed.msg_id) } : {}) };
      }
      return { status: "failed", error: `VietGuys error=${String(parsed.error ?? "?")}`.slice(0, 120) };
    } catch (e) {
      return { status: "failed", error: (e as Error).message };
    }
  },

  async healthCheck(config): Promise<HealthResult> {
    const ok = !!str(config["user"]) && !!str(config["apiKey"]) && !!str(config["brandname"]);
    return ok ? { ok: true } : { ok: false, error: "Thiếu user/password/brandname." };
  },
};
