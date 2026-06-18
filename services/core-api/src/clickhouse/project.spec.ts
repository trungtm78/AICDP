import { describe, it, expect } from "vitest";
import { buildOrderRow } from "./project.js";
import type { OrderCompletedEvent } from "../ingestion/ingestion.service.js";

// Map thuần (không cần ClickHouse) — luôn chạy.
describe("buildOrderRow (projection mapping)", () => {
  const ev: OrderCompletedEvent = {
    brand_id: "givral",
    store_id: "s1",
    source: "pos",
    occ_timestamp: "2026-06-18T03:00:00.000Z",
    identifiers: [{ type: "phone", value: "0901234567" }],
    properties: { pos_transaction_id: "T-1", total: 250000 },
  };

  it("map đủ field + occ_id rỗng khi null + occ_timestamp dạng CH", () => {
    const row = buildOrderRow(ev, "givral:s1:T-1", null);
    expect(row).toEqual({
      message_id: "givral:s1:T-1",
      occ_id: "",
      brand_id: "givral",
      store_id: "s1",
      source: "pos",
      pos_transaction_id: "T-1",
      currency: "VND", // mặc định khi thiếu
      total: 250000,
      occ_timestamp: "2026-06-18 03:00:00.000",
    });
  });

  it("giữ currency khi có + occ_id khi resolve được", () => {
    const row = buildOrderRow(
      { ...ev, properties: { ...ev.properties, currency: "USD" } },
      "givral:s1:T-2",
      "occ-123",
    );
    expect(row.currency).toBe("USD");
    expect(row.occ_id).toBe("occ-123");
  });
});
