import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Inject, HttpCode } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "./pg.provider.js";
import { validate } from "./validate.js";
import { AppError } from "./errors.js";
import { Roles } from "./auth/roles.js";
import {
  connectionCreateSchema,
  connectionStatusSchema,
  connectorCreateSchema,
  pipelineCreateSchema,
  pipelineSaveSchema,
  pipelineStatusSchema,
  applyTemplateSchema,
} from "./schemas.js";
import {
  getCatalog,
  listConnections, createConnection, setConnectionStatus, deleteConnection,
  createConnector, deleteConnector,
  listPipelines, getPipeline, createPipeline, savePipeline, setPipelineStatus, deletePipeline,
  applyTemplate,
  PipelineValidationError,
} from "../connector/connector.service.js";
import { testConnection } from "../connector/health.service.js";
import { listEvents, listDeliveries } from "../connector/logs.service.js";
import { dataSummary } from "../connector/data-summary.service.js";
import { issueInboundToken } from "../connector/inbound.service.js";

function notFound(entity: string): AppError {
  return new AppError({
    code: "NOT_FOUND", httpStatus: 404, message: `Không tìm thấy ${entity}.`,
    why: "Bản ghi không tồn tại.", fix: "Kiểm tra lại id.", retryable: false,
  });
}
function pipelineError(err: PipelineValidationError): AppError {
  return new AppError({
    code: "PIPELINE_INVALID", httpStatus: 400, message: err.message,
    why: "Định nghĩa pipeline chưa hợp lệ.", fix: "Thêm nguồn/đích hoặc sửa cạnh.", retryable: false,
  });
}

/** Connector & Pipeline builder (low-code): catalog + connection + custom connector + pipeline ETL. */
@Roles("data_steward")
@Controller("v1")
export class ConnectorController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get("connectors/catalog")
  async catalog() {
    return { data: await getCatalog(this.pool) };
  }

  // ── Custom connectors ──
  @Post("connectors")
  @HttpCode(201)
  async createConnectorRoute(@Body() body: unknown) {
    const dto = validate(connectorCreateSchema, body, "connector");
    await createConnector(this.pool, dto);
    return { data: { key: dto.key } };
  }

  @Delete("connectors/:key")
  async deleteConnectorRoute(@Param("key") key: string) {
    if (!(await deleteConnector(this.pool, key))) throw notFound("connector");
    return { data: { deleted: true } };
  }

  // ── Connections ──
  @Get("connections")
  async connections() {
    return { data: await listConnections(this.pool) };
  }

  @Post("connections")
  @HttpCode(201)
  async createConnectionRoute(@Body() body: unknown) {
    const dto = validate(connectionCreateSchema, body, "connection");
    return { data: await createConnection(this.pool, dto) };
  }

  @Patch("connections/:id/status")
  async connectionStatus(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(connectionStatusSchema, body, "connection_status");
    if (!(await setConnectionStatus(this.pool, id, dto.status))) throw notFound("connection");
    return { data: { id, status: dto.status } };
  }

  @Delete("connections/:id")
  async deleteConnectionRoute(@Param("id") id: string) {
    if (!(await deleteConnection(this.pool, id))) throw notFound("connection");
    return { data: { deleted: true } };
  }

  // ── Vận hành THẬT: health-check, token cổng vào, nhật ký, tổng hợp data ──
  @Post("connections/:id/test")
  @HttpCode(200)
  async testConnectionRoute(@Param("id") id: string) {
    return { data: await testConnection(this.pool, id) };
  }

  @Post("connections/:id/inbound-token")
  @HttpCode(201)
  async inboundTokenRoute(@Param("id") id: string) {
    // Reveal RAW token 1 lần (DB chỉ lưu sha256). Client phải lưu ngay.
    return { data: { token: await issueInboundToken(this.pool, id) } };
  }

  @Get("connections/:id/events")
  async connectionEvents(@Param("id") id: string) {
    return { data: await listEvents(this.pool, id) };
  }

  @Get("connections/:id/deliveries")
  async connectionDeliveries(@Param("id") id: string) {
    return { data: await listDeliveries(this.pool, id) };
  }

  @Get("connections/:id/data-summary")
  async connectionDataSummary(@Param("id") id: string) {
    return { data: await dataSummary(this.pool, id) };
  }

  // ── Áp dụng mô hình dựng sẵn ──
  @Post("connectors/apply-template")
  @HttpCode(201)
  async applyTemplateRoute(@Body() body: unknown) {
    const dto = validate(applyTemplateSchema, body, "apply_template");
    try {
      return { data: await applyTemplate(this.pool, dto.templateKey) };
    } catch (err) {
      if (err instanceof PipelineValidationError) throw pipelineError(err);
      throw err;
    }
  }

  // ── Pipelines ──
  @Get("pipelines")
  async pipelines() {
    return { data: await listPipelines(this.pool) };
  }

  @Get("pipelines/:id")
  async pipeline(@Param("id") id: string) {
    const p = await getPipeline(this.pool, id);
    if (!p) throw notFound("pipeline");
    return { data: p };
  }

  @Post("pipelines")
  @HttpCode(201)
  async createPipelineRoute(@Body() body: unknown) {
    const dto = validate(pipelineCreateSchema, body, "pipeline");
    return { data: await createPipeline(this.pool, dto) };
  }

  @Put("pipelines/:id")
  async savePipelineRoute(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(pipelineSaveSchema, body, "pipeline_save");
    try {
      const p = await savePipeline(this.pool, id, dto);
      if (!p) throw notFound("pipeline");
      return { data: p };
    } catch (err) {
      if (err instanceof PipelineValidationError) throw pipelineError(err);
      throw err;
    }
  }

  @Patch("pipelines/:id/status")
  async pipelineStatus(@Param("id") id: string, @Body() body: unknown) {
    const dto = validate(pipelineStatusSchema, body, "pipeline_status");
    try {
      if (!(await setPipelineStatus(this.pool, id, dto.status))) throw notFound("pipeline");
      return { data: { id, status: dto.status } };
    } catch (err) {
      if (err instanceof PipelineValidationError) throw pipelineError(err);
      throw err;
    }
  }

  @Delete("pipelines/:id")
  async deletePipelineRoute(@Param("id") id: string) {
    if (!(await deletePipeline(this.pool, id))) throw notFound("pipeline");
    return { data: { deleted: true } };
  }
}
