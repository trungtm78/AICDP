import { Controller, Get, Post, Body, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { getInsights } from "../analytics/analytics.service.js";
import { previewSegment } from "../segment/segment.service.js";
import { getModelCards } from "../prediction/prediction.service.js";
import { AppError } from "./errors.js";
import { Roles } from "./auth/roles.js";

// MCP gateway (demo-grade): expose CDP cho AI agent NGOÀI qua manifest tool + invoke.
// CHỈ ĐỌC / AGGREGATE PHI-PII (không trả occIds/tên/định danh). Gate API key + RBAC.

const TOOLS = [
  { name: "get_insights", description: "Tổng hợp phân tích: phân bố vòng đời, doanh thu theo thương hiệu, synergy cross-brand (phi-PII).", input: {} },
  { name: "preview_segment", description: "Đếm số khách khớp tiêu chí (KHÔNG trả danh sách occId). Input: SegmentCriteria.", input: { brandId: "string?", minSpend: "int?", lifecycleStage: "string?", churnProbGte: "0..1?", propensityGte: "0..1?" } },
  { name: "get_model_cards", description: "Thông tin model dự đoán ML (metric, phiên bản).", input: {} },
] as const;

@Roles("connector", "data_steward", "analyst", "marketer")
@Controller("v1/mcp")
export class McpController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Manifest tool (giống MCP): danh sách tool + schema input. */
  @Get("manifest")
  async manifest() {
    return { data: { name: "occ-cdp", version: "1.0", tools: TOOLS } };
  }

  /** Gọi một tool (read-only/aggregate phi-PII). */
  @Post("invoke")
  @HttpCode(200)
  async invoke(@Body() body: { tool?: string; args?: Record<string, unknown> }) {
    const tool = body?.tool;
    const args = body?.args ?? {};
    if (tool === "get_insights") {
      return { data: await getInsights(this.pool) };
    }
    if (tool === "preview_segment") {
      const seg = await previewSegment(this.pool, args as never);
      return { data: { count: seg.count } }; // CHỈ count — không lộ occIds (phi-PII)
    }
    if (tool === "get_model_cards") {
      return { data: await getModelCards(this.pool) };
    }
    throw new AppError({ code: "SCHEMA_TYPE_MISMATCH", httpStatus: 400, message: `Tool không hợp lệ: ${tool}`, why: "Tool không có trong manifest.", fix: "Xem GET /v1/mcp/manifest." });
  }
}
