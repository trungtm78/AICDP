import { Injectable, Inject, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../http/pg.provider.js";
import { recomputeAllTiers } from "./tier.service.js";

// Worker tính lại hạng (L4): quét khách có hoạt động / tới review_at rồi recompute tier. Interval
// thuần + single-flight + lifecycle Nest. State ở Postgres nên đơn-instance đủ. Chu kỳ dài (mặc định
// 1 giờ) — hạng không cần realtime tức thời (lên hạng cũng sẽ áp ở lần recompute kế).

const TICK_MS = Number(process.env.LOYALTY_TIER_TICK_MS ?? 3_600_000);
const BATCH = Number(process.env.LOYALTY_TIER_BATCH ?? 1000);

@Injectable()
export class LoyaltyTierScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("LoyaltyTierScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private current: Promise<{ groups: number; members: number }> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    if (process.env.LOYALTY_TIER_SCHEDULER_DISABLED === "1") return;
    this.timer = setInterval(() => void this.runOnce(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) await this.current.catch(() => undefined);
  }

  /** Một lượt recompute hạng (single-flight). Public để test/ops gọi trực tiếp. */
  runOnce(): Promise<{ groups: number; members: number }> {
    if (this.running) return Promise.resolve({ groups: 0, members: 0 });
    this.running = true;
    const p = this.doRun().finally(() => {
      this.running = false;
    });
    this.current = p;
    return p;
  }

  private async doRun(): Promise<{ groups: number; members: number }> {
    try {
      const r = await recomputeAllTiers(this.pool, BATCH);
      if (r.members > 0) this.log.log(`recompute hạng: ${r.members} khách / ${r.groups} nhóm`);
      return r;
    } catch (err) {
      this.log.error(`recompute hạng lỗi: ${err instanceof Error ? err.message : err}`);
      return { groups: 0, members: 0 };
    }
  }
}
