import { Injectable, Inject, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../http/pg.provider.js";
import { expireLots } from "./loyalty.service.js";

// Worker đáo hạn lô điểm (L2): mỗi lượt gọi expireLots() -> lô active quá hạn thành breakage
// (giảm liability, ghi nhận điểm vỡ). Interval thuần + single-flight + lifecycle Nest, giống
// JourneyScheduler. State ở Postgres nên đơn-instance đủ (multi-instance cần distributed lock).
// Đáo hạn không cần realtime -> chu kỳ dài (mặc định 1 giờ).

const TICK_MS = Number(process.env.LOYALTY_EXPIRY_TICK_MS ?? 3_600_000);

@Injectable()
export class LoyaltyExpiryScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("LoyaltyExpiryScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private current: Promise<number> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    if (process.env.LOYALTY_EXPIRY_SCHEDULER_DISABLED === "1") return;
    this.timer = setInterval(() => void this.runOnce(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) await this.current.catch(() => undefined);
  }

  /** Một lượt đáo hạn (single-flight). Public để test/ops gọi trực tiếp. Trả số lô đã đáo hạn. */
  runOnce(): Promise<number> {
    if (this.running) return Promise.resolve(0);
    this.running = true;
    const p = this.doRun().finally(() => {
      this.running = false;
    });
    this.current = p;
    return p;
  }

  private async doRun(): Promise<number> {
    try {
      const n = await expireLots(this.pool);
      if (n > 0) this.log.log(`đáo hạn ${n} lô điểm -> breakage`);
      return n;
    } catch (err) {
      this.log.error(`đáo hạn lỗi: ${err instanceof Error ? err.message : err}`);
      return 0;
    }
  }
}
