import { Controller, Get, Post, Put, Body, Param, Query, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { AppError } from "./errors.js";
import { journeyDraftSchema, journeySaveSchema, journeyEnrollSchema } from "./schemas.js";
import { Roles } from "./auth/roles.js";
import { runJourney } from "../journey/journey.service.js";
import {
  createDraft, saveDraft, getJourney, listJourneys, publish, activateJourney,
  setStatus, listParticipants, retryParticipant, forceExitParticipant,
  type CreateDraftArgs, type SaveArgs,
} from "../journey/journey-admin.service.js";
import { enroll, enrollSegment, tick } from "../journey/journey-engine.service.js";
import { JourneyValidationError, type JourneyDefinition } from "../journey/journey.types.js";

/** Journeys — orchestration đa bước (state machine + tick). RBAC: marketer. */
@Roles("marketer")
@Controller("v1/journeys")
export class JourneyController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get()
  async list() {
    return { data: await listJourneys(this.pool) };
  }

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const dto = validate(journeyDraftSchema, body, "journey_create") as CreateDraftArgs;
    return { data: await createDraft(this.pool, dto) };
  }

  @Post("tick")
  @HttpCode(200)
  @Roles("admin", "marketer")
  async runTick(@Body() body: { limit?: number } | undefined) {
    return { data: await tick(this.pool, { limit: body?.limit ?? 100 }) };
  }

  @Get(":id")
  async getOne(@Param("id") id: string) {
    const j = await getJourney(this.pool, id);
    if (!j) throw new AppError({ code: "JOURNEY_NOT_FOUND", httpStatus: 404, message: "Journey không tồn tại." });
    return { data: j };
  }

  @Put(":id")
  async save(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(journeySaveSchema, body, "journey_save") as SaveArgs;
    const j = await saveDraft(this.pool, id, dto);
    if (!j) throw new AppError({ code: "JOURNEY_NOT_EDITABLE", httpStatus: 409, message: "Journey không sửa được (chỉ draft/paused)." });
    return { data: j };
  }

  @Post(":id/publish")
  @HttpCode(200)
  async publishJourney(@Param("id") id: string) {
    try {
      return { data: await publish(this.pool, id, null) };
    } catch (err) {
      if (err instanceof JourneyValidationError) {
        throw new AppError({ code: "JOURNEY_INVALID", httpStatus: 400, message: err.message, why: err.message });
      }
      throw err;
    }
  }

  @Post(":id/activate")
  @HttpCode(200)
  async activate(@Param("id") id: string) {
    const j = await activateJourney(this.pool, id);
    if (!j) throw new AppError({ code: "JOURNEY_NOT_PUBLISHED", httpStatus: 409, message: "Cần publish trước khi activate." });
    return { data: j };
  }

  @Post(":id/pause")
  @HttpCode(200)
  async pause(@Param("id") id: string) {
    return { data: await setStatus(this.pool, id, "paused") };
  }

  @Post(":id/archive")
  @HttpCode(200)
  async archive(@Param("id") id: string) {
    return { data: await setStatus(this.pool, id, "archived") };
  }

  @Post(":id/enroll")
  @HttpCode(200)
  async enrollMembers(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(journeyEnrollSchema, body ?? {}, "journey_enroll");
    if (dto.useSegment) {
      return { data: { enrolled: await enrollSegment(this.pool, id) } };
    }
    let enrolled = 0;
    for (const occId of dto.occIds ?? []) {
      if ((await enroll(this.pool, id, occId)).enrolled) enrolled++;
    }
    return { data: { enrolled } };
  }

  @Get(":id/participants")
  async participants(
    @Param("id") id: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
  ) {
    const r = await listParticipants(this.pool, id, {
      ...(status ? { status } : {}),
      ...(limit ? { limit: Number(limit) } : {}),
      ...(offset ? { offset: Number(offset) } : {}),
    });
    return { data: r.rows, meta: { total: r.total } };
  }

  @Post(":id/participants/:pid/retry")
  @HttpCode(200)
  async retry(@Param("pid") pid: string) {
    return { data: { ok: await retryParticipant(this.pool, pid) } };
  }

  @Post(":id/participants/:pid/force-exit")
  @HttpCode(200)
  async forceExit(@Param("pid") pid: string) {
    return { data: { ok: await forceExitParticipant(this.pool, pid) } };
  }

  /** Legacy 1-step run (journey kiểu cũ, definition=null). Engine mới dùng enroll+tick. */
  @Post(":id/run")
  @HttpCode(200)
  async run(@Param("id") id: string) {
    const j = await getJourney(this.pool, id);
    if (j && (j.definition as JourneyDefinition | null)) {
      throw new AppError({ code: "JOURNEY_USE_ENROLL", httpStatus: 409, message: "Journey mới: dùng /enroll + tick, không dùng /run." });
    }
    return { data: await runJourney(this.pool, id) };
  }
}
