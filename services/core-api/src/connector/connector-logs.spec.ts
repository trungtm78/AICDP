import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { createConnection } from "./connector.service.js";
import { recordEvent, listEvents, recordDelivery, listDeliveries } from "./logs.service.js";
import { dataSummary } from "./data-summary.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

async function conn(direction = "source"): Promise<string> {
  const c = await createConnection(pool, { name: "t", direction, connectorKey: direction === "source" ? "src_webhook" : "dst_webhook" });
  return c.id;
}

describe("logs.service · event", () => {
  it("recordEvent + listEvents (mới nhất trước)", async () => {
    const id = await conn("source");
    await recordEvent(pool, { connectionId: id, eventType: "order_completed", messageId: "m1", status: "ingested" });
    await recordEvent(pool, { connectionId: id, eventType: "identify", status: "rejected", error: "bad token" });
    const rows = await listEvents(pool, id);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.eventType).toBe("identify");
    expect(rows[0]!.status).toBe("rejected");
    expect(rows[0]!.error).toBe("bad token");
    expect(rows[1]!.messageId).toBe("m1");
  });
});

describe("logs.service · delivery", () => {
  it("recordDelivery trả id + delivered_at set khi 'sent'; skipped -> null", async () => {
    const id = await conn("destination");
    const did = await recordDelivery(pool, { connectionId: id, channel: "webhook", recipient: "https://x.test", status: "sent", providerMessageId: "p1" });
    expect(did).toBeTruthy();
    await recordDelivery(pool, { connectionId: id, channel: "webhook", status: "skipped_no_contact" });
    const rows = await listDeliveries(pool, id);
    expect(rows).toHaveLength(2);
    const sent = rows.find((r) => r.status === "sent")!;
    expect(sent.deliveredAt).not.toBeNull();
    expect(sent.providerMessageId).toBe("p1");
    const skip = rows.find((r) => r.status === "skipped_no_contact")!;
    expect(skip.deliveredAt).toBeNull();
  });
});

describe("data-summary.service", () => {
  it("đếm event theo loại/status + delivery theo status", async () => {
    const src = await conn("source");
    await recordEvent(pool, { connectionId: src, eventType: "order_completed", status: "ingested" });
    await recordEvent(pool, { connectionId: src, eventType: "order_completed", status: "ingested" });
    await recordEvent(pool, { connectionId: src, eventType: "payment", status: "ingested" });
    await recordEvent(pool, { connectionId: src, eventType: "identify", status: "rejected" });

    const s = await dataSummary(pool, src);
    expect(s.events.total).toBe(4);
    expect(s.events.ingested).toBe(3);
    expect(s.events.rejected).toBe(1);
    expect(s.events.byType.order_completed).toBe(2);
    expect(s.events.byType.payment).toBe(1);

    const dst = await conn("destination");
    await recordDelivery(pool, { connectionId: dst, channel: "webhook", status: "sent" });
    await recordDelivery(pool, { connectionId: dst, channel: "webhook", status: "failed", error: "500" });
    await recordDelivery(pool, { connectionId: dst, channel: "webhook", status: "skipped_no_contact" });
    const s2 = await dataSummary(pool, dst);
    expect(s2.deliveries).toEqual({ total: 3, sent: 1, failed: 1, skipped: 1 });
  });

  it("connection rỗng -> tất cả 0", async () => {
    const id = await conn("source");
    const s = await dataSummary(pool, id);
    expect(s.events.total).toBe(0);
    expect(s.deliveries.total).toBe(0);
  });
});
