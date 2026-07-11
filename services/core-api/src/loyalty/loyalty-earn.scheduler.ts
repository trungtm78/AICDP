import { Injectable, Inject, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../http/pg.provider.js";
import { processUnearnedTransactions } from "./earn-rule.service.js";

// Worker auto-earn (L3): quét canonical_transaction chưa tích điểm rồi áp earn_rule. CHẠY NGOÀI
// ingest (CLAUDE.md: earn không ở ingest). Interval thuần + single-flight + lifecycle Nest.
// Idempotent theo message_id nên đơn-instance đủ.

const TICK_MS = Number(process.env.LOYALTY_EARN_TICK_MS ?? 30_000);
const BATCH = Number(process.env.LOYALTY_EARN_BATCH ?? 500);

@Injectable()
export class LoyaltyEarnScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("LoyaltyEarnScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private current: Promise<{ processed: number; earned: number }> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    if (process.env.LOYALTY_EARN_SCHEDULER_DISABLED === "1") return;
    this.timer = setInterval(() => void this.runOnce(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) await this.current.catch(() => undefined);
  }

  /** Một lượt auto-earn (single-flight). Public để test/ops gọi trực tiếp. */
  runOnce(): Promise<{ processed: number; earned: number }> {
    if (this.running) return Promise.resolve({ processed: 0, earned: 0 });
    this.running = true;
    const p = this.doRun().finally(() => {
      this.running = false;
    });
    this.current = p;
    return p;
  }

  private async doRun(): Promise<{ processed: number; earned: number }> {
    try {
      const r = await processUnearnedTransactions(this.pool, BATCH);
      if (r.processed > 0) this.log.log(`auto-earn ${r.processed} giao dịch -> ${r.earned} điểm`);
      return r;
    } catch (err) {
      this.log.error(`auto-earn lỗi: ${err instanceof Error ? err.message : err}`);
      return { processed: 0, earned: 0 };
    }
  }
}
