import { describe, it, expect } from "vitest";
import { makeRestInboundAdapter } from "./inbound-rest.js";
import type { OutboundDeps } from "./types.js";

const adapter = makeRestInboundAdapter("src_rest");
const lookup = async () => ["93.184.216.34"];
function fake(status: number, bodyObj: unknown, cap?: { url?: string; headers?: Record<string, string> }) {
  return (async (url: unknown, init: unknown) => {
    const i = init as { headers?: Record<string, string> };
    if (cap) { cap.url = String(url); cap.headers = i.headers; }
    return { status, text: async () => JSON.stringify(bodyObj) } as unknown as Response;
  }) as typeof fetch;
}
const deps = (status: number, body: unknown, cap?: Parameters<typeof fake>[2]): OutboundDeps => ({ lookup, fetchImpl: fake(status, body, cap) });

const mapping = {
  eventType: "order_completed",
  pos_transaction_id: "DocNum", total: "NetAmount", store_id: "Branch", member: "CardCode",
};
const cfg = { endpoint: "https://sap.example.com/odata/Invoices", apiKey: "TOK", payloadMapping: mapping };

describe("inbound-rest adapter (OData)", () => {
  it("map record -> events; auth Bearer; nextCursor theo @odata.nextLink", async () => {
    const cap: { url?: string; headers?: Record<string, string> } = {};
    const body = {
      value: [
        { DocNum: "INV1", NetAmount: "1000", Branch: "b1", CardCode: "C1" },
        { DocNum: "INV2", NetAmount: 2000, Branch: "b1" },
      ],
      "@odata.nextLink": "https://sap.example.com/odata/Invoices?$skiptoken=2",
    };
    const r = await adapter.pull(cfg, null, deps(200, body, cap));
    expect(r.events).toHaveLength(2);
    expect(r.events[0]!.data).toMatchObject({ type: "order_completed", store_id: "b1" });
    expect((r.events[0]!.data as any).properties.pos_transaction_id).toBe("INV1");
    expect((r.events[0]!.data as any).properties.total).toBe(1000);
    expect((r.events[0]!.data as any).identifiers).toContainEqual({ type: "pos_member_id", value: "C1" });
    expect(r.nextCursor).toEqual({ nextLink: "https://sap.example.com/odata/Invoices?$skiptoken=2" });
    expect(cap.headers?.["authorization"]).toBe("Bearer TOK");
  });

  it("pull trang kế dùng nextLink từ cursor", async () => {
    const cap: { url?: string } = {};
    await adapter.pull(cfg, { nextLink: "https://sap.example.com/page2" }, deps(200, { value: [] }, cap));
    expect(cap.url).toBe("https://sap.example.com/page2");
  });

  it("nextLink khác origin (rò token) -> CONNECTOR_MISCONFIGURED (chống exfil Authorization)", async () => {
    await expect(adapter.pull(cfg, { nextLink: "https://evil.example.com/steal" }, deps(200, { value: [] })))
      .rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("không @odata.nextLink -> nextCursor null (hết trang)", async () => {
    const r = await adapter.pull(cfg, null, deps(200, { value: [{ DocNum: "X", NetAmount: "1" }] }));
    expect(r.nextCursor).toBeNull();
  });

  it("mode offset -> URL kèm $skip/$top; nextCursor offset khi trang đầy", async () => {
    const cap: { url?: string } = {};
    const offCfg = { ...cfg, mode: "offset", pageSize: 2 };
    const r = await adapter.pull(offCfg, { offset: 4 }, deps(200, { value: [{ DocNum: "A", NetAmount: "1" }, { DocNum: "B", NetAmount: "2" }] }, cap));
    expect(cap.url).toContain("%24skip=4");
    expect(cap.url).toContain("%24top=2");
    expect(r.nextCursor).toEqual({ offset: 6 });
  });

  it("auth header tuỳ biến (authType=header)", async () => {
    const cap: { headers?: Record<string, string> } = {};
    await adapter.pull({ ...cfg, authType: "header", authHeaderName: "apikey" }, null, deps(200, { value: [] }, cap));
    expect(cap.headers?.["apikey"]).toBe("TOK");
    expect(cap.headers?.["authorization"]).toBeUndefined();
  });

  it("thiếu endpoint / payloadMapping -> CONNECTOR_MISCONFIGURED", async () => {
    await expect(adapter.pull({ payloadMapping: mapping }, null, deps(200, {}))).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
    await expect(adapter.pull({ endpoint: "https://x.example.com" }, null, deps(200, {}))).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("HTTP lỗi / body không JSON -> CONNECTOR_MISCONFIGURED", async () => {
    await expect(adapter.pull(cfg, null, deps(500, {}))).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
    const badJson: OutboundDeps = { lookup, fetchImpl: (async () => ({ status: 200, text: async () => "<html>" }) as unknown as Response) as typeof fetch };
    await expect(adapter.pull(cfg, null, badJson)).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("response @odata.nextLink KHÁC origin -> misconfigured (chống poison cursor + rò token)", async () => {
    const body = { value: [{ DocNum: "X", NetAmount: "1" }], "@odata.nextLink": "https://evil.example.com/next" };
    await expect(adapter.pull(cfg, null, deps(200, body))).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("nextLink TƯƠNG ĐỐI (OData) -> resolve về cùng-origin, không gãy", async () => {
    const cap: { url?: string } = {};
    const body = { value: [], "@odata.nextLink": "Invoices?$skiptoken=2" };
    const r = await adapter.pull(cfg, null, deps(200, body, cap));
    expect(r.nextCursor).toMatchObject({ nextLink: "https://sap.example.com/odata/Invoices?$skiptoken=2" });
  });

  it("số record/trang > 500 -> misconfigured (chống DoS map/ingest)", async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ DocNum: `D${i}`, NetAmount: "1" }));
    await expect(adapter.pull(cfg, null, deps(200, { value: many }))).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("authHeaderName ký tự lạ (CRLF/injection) -> misconfigured", async () => {
    await expect(adapter.pull({ ...cfg, authType: "header", authHeaderName: "x\r\nEvil: 1" }, null, deps(200, { value: [] })))
      .rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("payloadMapping là MẢNG -> misconfigured", async () => {
    await expect(adapter.pull({ endpoint: "https://x.example.com", payloadMapping: [] }, null, deps(200, {})))
      .rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("preset src_sap: default recordsPath 'd.results' + nextLink 'd.__next'", async () => {
    const sap = makeRestInboundAdapter("src_sap");
    const body = { d: { results: [{ DocNum: "S1", NetAmount: "9" }], __next: "https://sap.example.com/odata/next" } };
    const r = await sap.pull({ endpoint: "https://sap.example.com/odata/Invoices", apiKey: "T", payloadMapping: mapping }, null, deps(200, body));
    expect(r.events).toHaveLength(1);
    expect((r.events[0]!.data as any).properties.pos_transaction_id).toBe("S1");
    expect(r.nextCursor).toEqual({ nextLink: "https://sap.example.com/odata/next" });
  });
});
