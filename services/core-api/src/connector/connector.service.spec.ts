import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import {
  getCatalog, createConnector, listCustomConnectors, deleteConnector,
  listConnections, createConnection, setConnectionStatus, deleteConnection,
  createPipeline, getPipeline, savePipeline, setPipelineStatus, deletePipeline,
  validatePipeline, applyTemplate, PipelineValidationError,
  type PipelineDefinition,
} from "./connector.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

describe("connector — catalog & custom", () => {
  it("catalog tĩnh có connector RudderStack + Zalo ZNS + template", async () => {
    const c = await getCatalog(pool);
    expect(c.connectors.some((x) => x.key === "dst_zalo_zns" && x.vn)).toBe(true);
    expect(c.connectors.some((x) => x.key === "src_pos")).toBe(true);
    expect(c.templates.length).toBeGreaterThan(5);
  });

  it("tạo connector tuỳ biến → xuất hiện trong catalog; xoá được", async () => {
    await createConnector(pool, { key: "custom_erp", name: "ERP nội bộ", direction: "source", category: "Custom", transport: "rest", configSchema: [{ key: "baseUrl", label: "Base URL", type: "url" }] });
    expect((await listCustomConnectors(pool)).some((x) => x.key === "custom_erp")).toBe(true);
    const cat = await getCatalog(pool);
    expect(cat.connectors.some((x) => x.key === "custom_erp" && x.isCustom)).toBe(true);
    expect(await deleteConnector(pool, "custom_erp")).toBe(true);
    expect(await deleteConnector(pool, "custom_erp")).toBe(false);
  });
});

describe("connector — connections", () => {
  it("tạo/list/đổi trạng thái/xoá connection", async () => {
    const c = await createConnection(pool, { name: "Zalo", direction: "destination", connectorKey: "dst_zalo_zns" });
    expect(c.status).toBe("active");
    expect(c.connectorName).toContain("Zalo");
    expect((await listConnections(pool)).length).toBe(1);
    expect(await setConnectionStatus(pool, c.id, "paused")).toBe(true);
    expect((await listConnections(pool))[0]!.status).toBe("paused");
    expect(await deleteConnection(pool, c.id)).toBe(true);
    expect((await listConnections(pool)).length).toBe(0);
  });
});

describe("connector — pipelines", () => {
  const goodDef: PipelineDefinition = {
    nodes: [
      { id: "s", type: "source", config: { connectorKey: "src_pos" } },
      { id: "t", type: "transform", config: { kind: "normalize" } },
      { id: "d", type: "destination", config: { connectorKey: "dst_clickhouse" } },
    ],
    edges: [{ from: "s", to: "t" }, { from: "t", to: "d" }],
  };

  it("tạo → lưu definition → kích hoạt → xoá", async () => {
    const p = await createPipeline(pool, { name: "POS→CDP" });
    expect(p.status).toBe("draft");
    const saved = await savePipeline(pool, p.id, { definition: goodDef, kind: "event_stream" });
    expect(saved!.definition.nodes.length).toBe(3);
    expect(await setPipelineStatus(pool, p.id, "active")).toBe(true);
    expect((await getPipeline(pool, p.id))!.status).toBe("active");
    expect(await deletePipeline(pool, p.id)).toBe(true);
  });

  it("validate: thiếu source hoặc destination → lỗi", () => {
    expect(() => validatePipeline({ nodes: [{ id: "d", type: "destination" }], edges: [] })).toThrow(PipelineValidationError);
    expect(() => validatePipeline({ nodes: [{ id: "s", type: "source" }], edges: [] })).toThrow(PipelineValidationError);
    expect(() => validatePipeline(goodDef)).not.toThrow();
  });

  it("không cho kích hoạt pipeline sai (thiếu destination)", async () => {
    const p = await createPipeline(pool, { name: "sai", definition: { nodes: [{ id: "s", type: "source" }], edges: [] } });
    await expect(setPipelineStatus(pool, p.id, "active")).rejects.toBeInstanceOf(PipelineValidationError);
  });
});

describe("connector — áp dụng mô hình", () => {
  it("template pipeline → tạo pipeline active có 3 node", async () => {
    const r = await applyTemplate(pool, "tpl_pos_cdp");
    expect(r.kind).toBe("pipeline");
    const p = await getPipeline(pool, r.id);
    expect(p!.status).toBe("active");
    expect(p!.definition.nodes.length).toBe(3);
  });
  it("template connection → tạo connection active", async () => {
    const r = await applyTemplate(pool, "tpl_cdp_email");
    expect(r.kind).toBe("connection");
    expect((await listConnections(pool))[0]!.status).toBe("active");
  });
});
