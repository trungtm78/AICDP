import { Controller, Get } from "@nestjs/common";
import { Public, SkipRateLimit } from "./auth/roles.js";

@Controller("v1")
export class HealthController {
  @Public()
  // Liveness/readiness probe gọi rất dày -> không rate-limit (tránh probe tự DoS).
  @SkipRateLimit()
  @Get("health")
  health() {
    return { status: "ok", service: "core-api" };
  }
}
