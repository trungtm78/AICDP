import { registerInboundPull, registerOutbound } from "./registry.js";
import { postgresInboundAdapter } from "./inbound-postgres.js";
import { makeRestInboundAdapter } from "./inbound-rest.js";
import { webhookOutboundAdapter } from "./outbound-webhook.js";
import { ga4OutboundAdapter } from "./outbound-ga4.js";
import { zaloZnsOutboundAdapter } from "./outbound-zalo-zns.js";
import { esmsOutboundAdapter } from "./outbound-esms.js";
import { vietguysOutboundAdapter } from "./outbound-vietguys.js";

// Đăng ký tất cả adapter connector THẬT (import side-effect ở bootstrap). Thêm adapter mới ở đây.
// Nhãn install của connector trong catalog suy từ registry -> đăng ký ở đây khiến 'ready'.
registerInboundPull(postgresInboundAdapter);
// ERP REST/OData generic + preset SAP/Oracle (cùng logic, khác default config user khai).
for (const key of ["src_rest", "src_sap", "src_oracle"]) registerInboundPull(makeRestInboundAdapter(key));
registerOutbound(webhookOutboundAdapter);
registerOutbound(ga4OutboundAdapter);
registerOutbound(zaloZnsOutboundAdapter);
registerOutbound(esmsOutboundAdapter);
registerOutbound(vietguysOutboundAdapter);
