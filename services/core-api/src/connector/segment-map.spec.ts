import { describe, it, expect } from "vitest";
import { mapSegmentPayload } from "./segment-map.js";
import { extractWriteKey } from "../http/connector-ingest.controller.js";

// Mapper Segment -> shape inbound (thuần, không ném). Kiểm mọi nhánh map + rút writeKey.
describe("mapSegmentPayload", () => {
  it("track 'Order Completed' -> order_completed, fallback revenue + products + store từ config", () => {
    const out = mapSegmentPayload(
      { type: "track", event: "Order Completed", userId: "u1", anonymousId: "a1",
        timestamp: "2026-07-11T00:00:00.000Z",
        properties: { order_id: "O1", revenue: 500, currency: "VND", products: [{ sku: "x" }], email: "e@x.com" } },
      { store_id: "web" },
    ) as Record<string, any>;
    expect(out.type).toBe("order_completed");
    expect(out.store_id).toBe("web");
    expect(out.occ_timestamp).toBe("2026-07-11T00:00:00.000Z");
    expect(out.properties.pos_transaction_id).toBe("O1");
    expect(out.properties.total).toBe(500);
    expect(out.properties.items).toHaveLength(1);
    expect(out.identifiers).toEqual([
      { type: "pos_member_id", value: "u1" },
      { type: "web_anonymous_id", value: "a1" },
      { type: "email", value: "e@x.com" },
    ]);
  });

  it("track order dùng orderEvent tuỳ biến + store_id trong properties", () => {
    const out = mapSegmentPayload(
      { type: "track", event: "Checkout Completed", properties: { orderId: "O2", value: 10, store_id: "s9" } },
      { orderEvent: "Checkout Completed" },
    ) as Record<string, any>;
    expect(out.type).toBe("order_completed");
    expect(out.store_id).toBe("s9");
    expect(out.properties.pos_transaction_id).toBe("O2");
    expect(out.properties.total).toBe(10);
  });

  it("track không phải order -> type = tên sự kiện (downstream UNKNOWN)", () => {
    expect(mapSegmentPayload({ type: "track", event: "Product Viewed" }, {})).toEqual({ type: "Product Viewed" });
    expect(mapSegmentPayload({ type: "track" }, {})).toEqual({ type: "track" });
  });

  it("identify -> ghép full_name từ firstName/lastName, birthday hợp lệ, bỏ birthday sai định dạng", () => {
    const ok = mapSegmentPayload(
      { type: "identify", userId: "u", traits: { firstName: "A", lastName: "B", phone: "090", birthday: "2000-01-02" } },
      {},
    ) as Record<string, any>;
    expect(ok.traits.full_name).toBe("A B");
    expect(ok.traits.birth_date).toBe("2000-01-02");
    expect(ok.identifiers).toContainEqual({ type: "phone", value: "090" });

    const bad = mapSegmentPayload(
      { type: "identify", traits: { name: "Full", birthday: "2000/01/02" } },
      {},
    ) as Record<string, any>;
    expect(bad.traits.full_name).toBe("Full");
    expect(bad.traits.birth_date).toBeUndefined();
    expect(bad.traits.city).toBeUndefined();
  });

  it("identify không traits -> chỉ identifiers, không field traits", () => {
    const out = mapSegmentPayload({ type: "identify", userId: "u" }, {}) as Record<string, any>;
    expect(out.traits).toBeUndefined();
    expect(out.identifiers).toEqual([{ type: "pos_member_id", value: "u" }]);
  });

  it("type lạ / thiếu -> unknown", () => {
    expect(mapSegmentPayload({ type: "group" }, {})).toEqual({ type: "group" });
    expect(mapSegmentPayload({}, {})).toEqual({ type: "unknown" });
    expect(mapSegmentPayload(null, {})).toEqual({ type: "unknown" });
  });
});

describe("extractWriteKey", () => {
  it("ưu tiên X-Write-Key", () => {
    expect(extractWriteKey("Basic xxx", "wk_header")).toBe("wk_header");
  });
  it("giải mã Basic auth (writeKey:'')", () => {
    const b64 = Buffer.from("wk_abc:").toString("base64");
    expect(extractWriteKey(`Basic ${b64}`, undefined)).toBe("wk_abc");
  });
  it("Basic không có dấu ':' -> lấy toàn chuỗi", () => {
    const b64 = Buffer.from("wk_nocolon").toString("base64");
    expect(extractWriteKey(`Basic ${b64}`, undefined)).toBe("wk_nocolon");
  });
  it("thiếu header -> ''", () => {
    expect(extractWriteKey(undefined, undefined)).toBe("");
    expect(extractWriteKey("Bearer abc", "")).toBe("");
  });
});
