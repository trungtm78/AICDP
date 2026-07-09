import type { Pool } from "pg";
import { enroll, enrollSegment } from "./journey-engine.service.js";
import type { JourneyDefinition, EntryConfig } from "./journey.types.js";

// Trigger enroll: event (real-time từ ingestion) + segment (quét định kỳ bởi scheduler).
// Cả hai đều best-effort — lỗi KHÔNG được làm hỏng ingestion hay tick.

/** Enroll occId vào mọi journey active kiểu event khớp eventName. eventName lấy từ
 *  trigger_config.eventName HOẶC entry node của definition đã publish (chống lệch/thiếu config). */
export async function enrollEventJourneys(pool: Pool, occId: string, eventName: string): Promise<number> {
  const jr = await pool.query<{ journey_id: string; trigger_config: Record<string, unknown> | null; definition: JourneyDefinition | null }>(
    `SELECT j.journey_id, j.trigger_config, v.definition
       FROM cdp.journey j
       JOIN cdp.journey_version v ON v.journey_id=j.journey_id AND v.version=j.published_version
      WHERE j.status='active' AND j.trigger_type='event'`,
  );
  let n = 0;
  for (const row of jr.rows) {
    const fromCfg = typeof row.trigger_config?.eventName === "string" ? (row.trigger_config.eventName as string) : undefined;
    const entry = row.definition?.nodes.find((nd) => nd.type === "entry");
    const fromEntry = (entry?.config as EntryConfig | undefined)?.eventName;
    if ((fromCfg ?? fromEntry) !== eventName) continue;
    if ((await enroll(pool, row.journey_id, occId)).enrolled) n++;
  }
  return n;
}

/** Quét mọi journey active kiểu segment → enroll khách mới khớp segment. Trả tổng enroll mới. */
export async function runSegmentEntry(pool: Pool): Promise<number> {
  const jr = await pool.query<{ journey_id: string }>(
    "SELECT journey_id FROM cdp.journey WHERE status='active' AND trigger_type='segment'",
  );
  let n = 0;
  for (const row of jr.rows) {
    n += await enrollSegment(pool, row.journey_id);
  }
  return n;
}
