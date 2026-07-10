import { Controller, Post, Get, Body, Query, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import {
  consentRecordSchema,
  consentListQuerySchema,
  consentCheckQuerySchema,
} from "./schemas.js";
import { recordConsent, listConsents, isAllowed, listConsentHistory, verifyConsentChain } from "../consent/consent.service.js";
import { Roles } from "./auth/roles.js";

/** Consent deny-by-default. /check là chokepoint dành cho ACTIVATION (không gate ingestion/loyalty). */
@Roles("compliance", "csr", "marketer", "analyst")
@Controller("v1/consent")
export class ConsentController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Roles("compliance", "csr")
  @Post()
  @HttpCode(201)
  async record(@Body() body: unknown) {
    const dto = validate(consentRecordSchema, body, "consent_record");
    return {
      data: await recordConsent(this.pool, {
        occId: dto.occId,
        purpose: dto.purpose,
        status: dto.status,
        source: dto.source,
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.evidence !== undefined ? { evidence: dto.evidence } : {}),
      }),
    };
  }

  @Get()
  async list(@Query() query: Record<string, string>) {
    const { occId } = validate(consentListQuerySchema, query, "consent_list");
    return { data: await listConsents(this.pool, occId) };
  }

  @Get("check")
  async check(@Query() query: Record<string, string>) {
    const { occId, purpose } = validate(consentCheckQuerySchema, query, "consent_check");
    return { data: { occId, purpose, allowed: await isAllowed(this.pool, occId, purpose) } };
  }

  /** Drill-down: timeline cấp/thu hồi của một purpose. */
  @Get("history")
  async history(@Query() query: Record<string, string>) {
    const { occId, purpose } = validate(consentCheckQuerySchema, query, "consent_history");
    return { data: await listConsentHistory(this.pool, occId, purpose) };
  }

  /** Governance: kiểm tra tính toàn vẹn chuỗi băm consent (tamper-evident). */
  @Roles("compliance", "data_steward")
  @Get("chain/verify")
  async chainVerify() {
    return { data: await verifyConsentChain(this.pool) };
  }
}
