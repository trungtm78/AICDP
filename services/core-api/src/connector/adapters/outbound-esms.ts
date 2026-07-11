import { safeFetch } from "../http-client.js";
import { str, fetchOpts } from "./outbound-util.js";
import type { OutboundAdapter, OutboundMessage, DeliveryResult, HealthResult } from "./types.js";

// Adapter OUTBOUND eSMS.vn (SMS brandname VN). POST JSON tới rest.esms.vn SendMultipleMessage_V4.
// config: apiKey(ApiKey secret), secretKey(SecretKey secret), brandname. recipient=phone (không có ->
// skipped). CodeResult '100' = thành công. Đối chiếu SmsType/endpoint với tài liệu eSMS trước prod.

const ESMS_URL = "https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/";

export const esmsOutboundAdapter: OutboundAdapter = {
  key: "dst_esms",

  async deliver(config, msg: OutboundMessage, deps): Promise<DeliveryResult> {
    const apiKey = str(config["apiKey"]);
    const secretKey = str(config["secretKey"]);
    const brandname = str(config["brandname"]);
    if (!apiKey || !secretKey || !brandname) return { status: "failed", error: "Thiếu apiKey/secretKey/brandname." };
    const phone = str(msg.recipient) ?? str(msg.payload["phone"]);
    if (!phone) return { status: "skipped_no_contact", error: "Không có số điện thoại." };
    // Default TRUNG TÍNH — KHÔNG chèn tên audience/segment (nhãn nội bộ/PII) vào tin gửi tới khách.
    // Campaign thật phải truyền content/message (wiring composer nội dung ở Phase FE sau).
    const content = str(msg.payload["content"]) ?? str(msg.payload["message"]) ?? "OCC-CDP: thông báo từ hệ thống.";

    const body = JSON.stringify({
      ApiKey: apiKey, SecretKey: secretKey, Brandname: brandname,
      Phone: phone, Content: content, SmsType: "2", IsUnicode: "1",
    });
    try {
      const res = await safeFetch(ESMS_URL, fetchOpts({ method: "POST", headers: { "content-type": "application/json" }, body }, deps));
      if (!res.ok) return { status: "failed", error: `HTTP ${res.status}` };
      let parsed: { CodeResult?: unknown; SMSID?: unknown; ErrorMessage?: unknown } = {};
      try { parsed = JSON.parse(res.body) as typeof parsed; } catch { /* không JSON */ }
      if (String(parsed.CodeResult) === "100") {
        return { status: "sent", ...(parsed.SMSID != null ? { providerMessageId: String(parsed.SMSID) } : {}) };
      }
      return { status: "failed", error: `eSMS CodeResult=${String(parsed.CodeResult ?? "?")}`.slice(0, 120) };
    } catch (e) {
      return { status: "failed", error: (e as Error).message };
    }
  },

  async healthCheck(config): Promise<HealthResult> {
    const ok = !!str(config["apiKey"]) && !!str(config["secretKey"]) && !!str(config["brandname"]);
    return ok ? { ok: true } : { ok: false, error: "Thiếu apiKey/secretKey/brandname." };
  },
};
