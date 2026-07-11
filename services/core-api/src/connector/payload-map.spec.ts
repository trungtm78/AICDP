import { describe, it, expect } from "vitest";
import { applyPayloadMapping } from "./payload-map.js";

// Mapper field-path (thuần). Kiểm rút dot-path + hằng '=' + coerce số/timestamp + identify.
describe("applyPayloadMapping", () => {
  const kiotviet = {
    data: { code: "HD1", total: "150000", branch: "web1", buyDate: "2024-01-02 10:00:00", customer: { phone: "0900000001", email: "a@b.com" }, details: [{ sku: "X" }] },
  };
  const orderMapping = {
    eventType: "order_completed",
    store_id: "data.branch",
    pos_transaction_id: "data.code",
    total: "data.total",
    currency: "=VND",
    occ_timestamp: "data.buyDate",
    phone: "data.customer.phone",
    email: "data.customer.email",
    items: "data.details",
  };

  it("map order native -> shape CDP; coerce total string->number; timestamp->ISO; hằng '=' ", () => {
    const out = applyPayloadMapping(kiotviet, orderMapping) as Record<string, any>;
    expect(out.type).toBe("order_completed");
    expect(out.store_id).toBe("web1");
    expect(out.properties.pos_transaction_id).toBe("HD1");
    expect(out.properties.total).toBe(150000);
    expect(out.properties.currency).toBe("VND");
    expect(out.properties.items).toHaveLength(1);
    expect(out.occ_timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(out.identifiers).toEqual([
      { type: "phone", value: "0900000001" },
      { type: "email", value: "a@b.com" },
    ]);
  });

  it("store_id default 'webhook' khi path không có; timestamp lỗi -> bỏ (service default now)", () => {
    const out = applyPayloadMapping({ data: { code: "H", total: 10 } }, { eventType: "order_completed", pos_transaction_id: "data.code", total: "data.total", occ_timestamp: "data.nope" }) as Record<string, any>;
    expect(out.store_id).toBe("webhook");
    expect(out.occ_timestamp).toBeUndefined();
  });

  it("total phi số -> undefined (downstream zod báo thiếu)", () => {
    const out = applyPayloadMapping({ t: "abc" }, { eventType: "order_completed", pos_transaction_id: "=X", total: "t" }) as Record<string, any>;
    expect(out.properties.total).toBeUndefined();
  });

  it("identify: traits + identifiers (member=pos_member_id)", () => {
    const out = applyPayloadMapping(
      { c: { name: "A", phone: "090", city: "HN", mem: "M1" } },
      { eventType: "identify", full_name: "c.name", phone: "c.phone", city: "c.city", member: "c.mem" },
    ) as Record<string, any>;
    expect(out.type).toBe("identify");
    expect(out.traits).toEqual({ full_name: "A", phone: "090", city: "HN" });
    expect(out.identifiers).toContainEqual({ type: "pos_member_id", value: "M1" });
  });

  it("eventType lạ / thiếu -> unknown (downstream UNKNOWN_EVENT_TYPE)", () => {
    expect(applyPayloadMapping({}, { eventType: "page" })).toEqual({ type: "page" });
    expect(applyPayloadMapping({}, {})).toEqual({ type: "unknown" });
    expect(applyPayloadMapping({}, null)).toEqual({ type: "unknown" });
  });
});
