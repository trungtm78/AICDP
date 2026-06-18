import { Controller, Get } from "@nestjs/common";

@Controller("v1")
export class HealthController {
  @Get("health")
  health() {
    return { status: "ok", service: "core-api" };
  }
}
