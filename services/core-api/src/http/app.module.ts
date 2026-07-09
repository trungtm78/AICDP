import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { pgPoolProvider } from "./pg.provider.js";
import { chClientProvider } from "./ch.provider.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { RolesGuard } from "./auth/roles.guard.js";
import { IpRateLimitGuard } from "./rate-limit/ip-rate-limit.guard.js";
import { RateLimitGuard } from "./rate-limit/rate-limit.guard.js";
import { HealthController } from "./health.controller.js";
import { MastersController } from "./masters.controller.js";
import { IngestController } from "./ingest.controller.js";
import { CustomersController } from "./customers.controller.js";
import { LoyaltyController } from "./loyalty.controller.js";
import { ConsentController } from "./consent.controller.js";
import { ActivationController } from "./activation.controller.js";
import { AnalyticsController } from "./analytics.controller.js";
import { SegmentController } from "./segment.controller.js";
import { AiController } from "./ai.controller.js";
import { AiConfigController } from "./ai-config.controller.js";
import { FeatureController } from "./feature.controller.js";
import { AssistantController } from "./assistant.controller.js";
import { JourneyController } from "./journey.controller.js";
import { AuthController } from "./auth.controller.js";
import { JourneyScheduler } from "../journey/journey-scheduler.js";

@Module({
  controllers: [
    HealthController,
    AuthController,
    MastersController,
    IngestController,
    CustomersController,
    LoyaltyController,
    ConsentController,
    ActivationController,
    AnalyticsController,
    SegmentController,
    AiController,
    AiConfigController,
    FeatureController,
    AssistantController,
    JourneyController,
  ],
  providers: [
    pgPoolProvider,
    chClientProvider,
    JourneyScheduler,
    // Thứ tự guard: rate-limit IP PRE-AUTH (shed flood trước khi tốn JWT/DB) -> xác thực
    // (AuthGuard) -> rate-limit theo principal/login (RateLimitGuard) -> phân quyền (RolesGuard).
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
