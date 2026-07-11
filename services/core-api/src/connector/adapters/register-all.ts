import { registerInboundPull, registerOutbound } from "./registry.js";
import { postgresInboundAdapter } from "./inbound-postgres.js";
import { webhookOutboundAdapter } from "./outbound-webhook.js";

// Đăng ký tất cả adapter connector THẬT (import side-effect ở bootstrap). Thêm adapter mới ở đây.
// Nhãn install của connector trong catalog suy từ registry -> đăng ký ở đây khiến 'ready'.
registerInboundPull(postgresInboundAdapter);
registerOutbound(webhookOutboundAdapter);
