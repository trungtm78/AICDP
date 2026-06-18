import { Module } from "@nestjs/common";
import { pgPoolProvider } from "./pg.provider.js";
import { HealthController } from "./health.controller.js";
import { MastersController } from "./masters.controller.js";
import { IngestController } from "./ingest.controller.js";
import { CustomersController } from "./customers.controller.js";
import { LoyaltyController } from "./loyalty.controller.js";
import { ConsentController } from "./consent.controller.js";
import { ActivationController } from "./activation.controller.js";
import { AnalyticsController } from "./analytics.controller.js";

@Module({
  controllers: [
    HealthController,
    MastersController,
    IngestController,
    CustomersController,
    LoyaltyController,
    ConsentController,
    ActivationController,
    AnalyticsController,
  ],
  providers: [pgPoolProvider],
})
export class AppModule {}
