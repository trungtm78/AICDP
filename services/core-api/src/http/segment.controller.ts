import { Controller, Post, Body, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { segmentPreviewSchema } from "./schemas.js";
import { previewSegment } from "../segment/segment.service.js";
import { Roles } from "./auth/roles.js";

/** Segment builder — preview occId theo tiêu chí (feed vào activation). */
@Roles("marketer", "analyst")
@Controller("v1/segments")
export class SegmentController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Post("preview")
  @HttpCode(200)
  async preview(@Body() body: unknown) {
    const dto = validate(segmentPreviewSchema, body, "segment_preview");
    return { data: await previewSegment(this.pool, dto) };
  }
}
