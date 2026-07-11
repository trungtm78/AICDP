import { safeFetch } from "../http-client.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { OutboundAdapter, OutboundMessage, DeliveryResult, HealthResult } from "./types.js";

// Adapter OUTBOUND Zalo ZNS (Zalo Notification Service, kênh CSKH phổ biến VN). POST template message
// tới business.openapi.zalo.me/message/template, header access_token=config.apiKey (secret). recipient
// = số điện thoại (msg.recipient); không có -> skipped_no_contact. Zalo trả {error:0} = gửi thành công.
// healthCheck: xác thực config có mặt (ZNS không có endpoint probe miễn phí; gửi thật tốn quota).

const ZNS_URL = "https://business.openapi.zalo.me/message/template";

export const zaloZnsOutboundAdapter: OutboundAdapter = {
  key: "dst_zalo_zns",

  async deliver(config, msg: OutboundMessage, deps): Promise<DeliveryResult> {
    const accessToken = str(config["apiKey"]);
    const templateId = str(msg.payload["template_id"]) ?? str(config["templateId"]);
    if (!accessToken || !templateId) return { status: "failed", error: "Thiếu access_token/templateId." };
    const phone = str(msg.recipient) ?? str(msg.payload["phone"]);
    if (!phone) return { status: "skipped_no_contact", error: "Không có số điện thoại người nhận." };

    const body = JSON.stringify({
      phone,
      template_id: templateId,
      template_data: msg.payload["template_data"] ?? msg.payload,
      ...(msg.occId ? { tracking_id: msg.occId } : {}),
    });
    try {
      const res = await safeFetch(
        ZNS_URL,
        fetchOpts({ method: "POST", headers: { "content-type": "application/json", access_token: accessToken }, body }, deps),
      );
      if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` };
      // Zalo trả JSON {error:0, message, data:{msg_id}}; error!=0 = thất bại nghiệp vụ.
      let parsed: { error?: unknown; message?: unknown; data?: { msg_id?: unknown } } = {};
      try { parsed = JSON.parse(res.body) as typeof parsed; } catch { /* body không JSON */ }
      if (Number(parsed.error) === 0) {
        const msgId = parsed.data?.msg_id;
        return { status: "sent", ...(msgId != null ? { providerMessageId: String(msgId) } : {}) };
      }
      return { status: "failed", error: `Zalo error=${String(parsed.error ?? "?")}: ${String(parsed.message ?? "")}`.slice(0, 200) };
    } catch (e) {
      return { status: "failed", error: (e as Error).message };
    }
  },

  async healthCheck(config): Promise<HealthResult> {
    const ok = !!str(config["apiKey"]) && !!str(config["templateId"]);
    return ok ? { ok: true } : { ok: false, error: "Thiếu access_token/templateId trong cấu hình." };
  },
};
