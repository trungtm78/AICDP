import { Module } from "@nestjs/common";
import { pgPoolProvider } from "./pg.provider.js";
import { HealthController } from "./health.controller.js";
import { MastersController } from "./masters.controller.js";
import { IngestController } from "./ingest.controller.js";
import { CustomersController } from "./customers.controller.js";

@Module({
  controllers: [
    HealthController,
    MastersController,
    IngestController,
    CustomersController,
  ],
  providers: [pgPoolProvider],
})
export class AppModule {}
