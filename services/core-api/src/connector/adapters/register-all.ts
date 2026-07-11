import { registerInboundPull } from "./registry.js";
import { postgresInboundAdapter } from "./inbound-postgres.js";

// Đăng ký tất cả adapter connector THẬT (import side-effect ở bootstrap). Thêm adapter mới ở đây.
// Nhãn install của connector trong catalog suy từ registry -> đăng ký ở đây khiến 'ready'.
registerInboundPull(postgresInboundAdapter);
