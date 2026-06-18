import { Controller, Get } from "@nestjs/common";
import { Public } from "./auth/roles.js";

@Controller("v1")
export class HealthController {
  @Public()
  @Get("health")
  health() {
    return { status: "ok", service: "core-api" };
  }
}
