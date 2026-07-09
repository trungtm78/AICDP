import { Injectable, Inject, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../http/pg.provider.js";
import { tick } from "./journey-engine.service.js";
import { runSegmentEntry } from "./journey-triggers.service.js";

// Tick worker BỀN VỮNG: interval trong process, single-flight (không chồng lượt), lifecycle
// bởi Nest (start ở bootstrap, stop ở destroy). Dùng interval thuần thay @nestjs/schedule vì
// runtime tsx KHÔNG emit decorator-metadata (rủi ro discovery). State ở Postgres nên
// đơn-instance là đủ (multi-instance cần distributed lock — ngoài scope).
//
// Mỗi lượt: tick() advance participant đến hạn. Mỗi SEGMENT_EVERY lượt: quét segment-entry.

const TICK_MS = Number(process.env.JOURNEY_TICK_MS ?? 20_000);
const SEGMENT_EVERY = Number(process.env.JOURNEY_SEGMENT_EVERY ?? 3); // ~ mỗi 60s nếu tick 20s

@Injectable()
export class JourneyScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("JourneyScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private runs = 0;
  private current: Promise<{ processed: number; enrolled: number }> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    if (process.env.JOURNEY_SCHEDULER_DISABLED === "1") return;
    this.timer = setInterval(() => void this.runOnce(), TICK_MS);
    if (this.timer.unref) this.timer.unref(); // không giữ process sống chỉ vì timer
  }

  /** Dừng gọn: ngừng interval + ĐỢI lượt đang chạy hoàn tất (không cắt giữa mutate DB). */
  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) await this.current.catch(() => undefined);
  }

  /** Một lượt scheduler (single-flight). Public để test gọi trực tiếp. */
  runOnce(): Promise<{ processed: number; enrolled: number }> {
    if (this.running) return Promise.resolve({ processed: 0, enrolled: 0 });
    this.running = true;
    const p = this.doRun().finally(() => {
      this.running = false;
    });
    this.current = p;
    return p;
  }

  private async doRun(): Promise<{ processed: number; enrolled: number }> {
    try {
      const withSegments = this.runs % SEGMENT_EVERY === 0;
      this.runs++;
      let enrolled = 0;
      if (withSegments) {
        try {
          enrolled = await runSegmentEntry(this.pool);
        } catch (err) {
          this.log.warn(`segment-entry lỗi (bỏ qua): ${err instanceof Error ? err.message : err}`);
        }
      }
      const t = await tick(this.pool, { limit: 200 });
      return { processed: t.processed, enrolled };
    } catch (err) {
      this.log.error(`tick lỗi: ${err instanceof Error ? err.message : err}`);
      return { processed: 0, enrolled: 0 };
    }
  }
}
