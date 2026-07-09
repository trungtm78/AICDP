import { Controller, Post, Get, Body, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { segmentPreviewSchema, lookalikeSchema } from "./schemas.js";
import { previewSegment } from "../segment/segment.service.js";
import { lookalike } from "../segment/lookalike.service.js";
import { listSmartSegments } from "../segment/smart-segments.service.js";
import { Roles } from "./auth/roles.js";

/** Segment builder — preview occId theo tiêu chí (feed vào activation) + lookalike + smart segments. */
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

  /** Lookalike: mở rộng audience từ tập seed (tương đồng RFM+hành vi). */
  @Post("lookalike")
  @HttpCode(200)
  async lookalike(@Body() body: unknown) {
    const dto = validate(lookalikeSchema, body, "segment_lookalike");
    return { data: await lookalike(this.pool, dto.seedOccIds, dto.limit ?? 50) };
  }

  /** Smart segments gợi ý sẵn (preset dùng điểm dự đoán) + số khách. */
  @Get("suggestions")
  async suggestions() {
    return { data: await listSmartSegments(this.pool) };
  }
}
