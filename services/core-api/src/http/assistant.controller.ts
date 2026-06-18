import { Controller, Post, Body, Req, HttpCode, Inject } from "@nestjs/common";
import type { Request } from "express";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import {
  assistantAskSchema,
  assistantSegmentSchema,
  assistantContentSchema,
  assistantExplainSchema,
} from "./schemas.js";
import { askAssistant, nlToSegment, generateContent, explainCustomer } from "../llm/assistant.service.js";
import { Roles } from "./auth/roles.js";
import type { AuthContext } from "./auth/roles.js";

/** AI Assistant (generative, LLM). RBAC: marketer/analyst. Bật/tắt qua ai_config.features.assistant. */
@Roles("marketer", "analyst")
@Controller("v1/ai/assistant")
export class AssistantController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private pid(req: Request): string | undefined {
    return (req as Request & { auth?: AuthContext }).auth?.principalId;
  }

  @Post("ask")
  @HttpCode(200)
  async ask(@Body() body: unknown, @Req() req: Request) {
    const q = validate(assistantAskSchema, body, "ai_assistant_ask");
    return { data: await askAssistant(this.pool, q.question, this.pid(req)) };
  }

  @Post("segment")
  @HttpCode(200)
  async segment(@Body() body: unknown, @Req() req: Request) {
    const q = validate(assistantSegmentSchema, body, "ai_assistant_segment");
    return { data: await nlToSegment(this.pool, q.description, this.pid(req)) };
  }

  @Post("content")
  @HttpCode(200)
  async content(@Body() body: unknown, @Req() req: Request) {
    const q = validate(assistantContentSchema, body, "ai_assistant_content");
    return {
      data: await generateContent(
        this.pool,
        { brief: q.brief, ...(q.brandVoice !== undefined ? { brandVoice: q.brandVoice } : {}), ...(q.channel !== undefined ? { channel: q.channel } : {}) },
        this.pid(req),
      ),
    };
  }

  @Post("explain")
  @HttpCode(200)
  async explain(@Body() body: unknown, @Req() req: Request) {
    const q = validate(assistantExplainSchema, body, "ai_assistant_explain");
    return { data: await explainCustomer(this.pool, q.occId, this.pid(req)) };
  }
}
