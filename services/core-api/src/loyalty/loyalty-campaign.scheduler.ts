import { Injectable, Inject, type OnApplicationBootstrap, type OnModuleDestroy, Logger } from "@nestjs/common";
import type { Pool } from "pg";
import { PG_POOL } from "../http/pg.provider.js";
import { updateChallengesForMember, processReferralReward, grantBirthdayBonus } from "./campaign.service.js";

// Worker campaign/gamification (L6): cập nhật tiến độ challenge + thưởng referral cho khách CÓ hoạt
// động gần đây, + quà sinh nhật. Interval thuần + single-flight + lifecycle Nest. Idempotent nên
// đơn-instance đủ. Chu kỳ vừa phải (mặc định 5 phút).

const TICK_MS = Number(process.env.LOYALTY_CAMPAIGN_TICK_MS ?? 300_000);
const BATCH = Number(process.env.LOYALTY_CAMPAIGN_BATCH ?? 1000);

@Injectable()
export class LoyaltyCampaignScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger("LoyaltyCampaignScheduler");
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private current: Promise<{ members: number; granted: number }> | null = null;

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  onApplicationBootstrap(): void {
    if (process.env.LOYALTY_CAMPAIGN_SCHEDULER_DISABLED === "1") return;
    this.timer = setInterval(() => void this.runOnce(), TICK_MS);
    if (this.timer.unref) this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.current) await this.current.catch(() => undefined);
  }

  runOnce(): Promise<{ members: number; granted: number }> {
    if (this.running) return Promise.resolve({ members: 0, granted: 0 });
    this.running = true;
    const p = this.doRun().finally(() => { this.running = false; });
    this.current = p;
    return p;
  }

  private async doRun(): Promise<{ members: number; granted: number }> {
    try {
      // Khách có giao dịch trong 40 ngày (bao cửa sổ challenge tháng) — keyset theo occ_id.
      let cursor = "00000000-0000-0000-0000-000000000000";
      let members = 0, granted = 0;
      for (;;) {
        const rows = (await this.pool.query<{ occ_id: string }>(
          `SELECT DISTINCT occ_id FROM cdp.canonical_transaction
            WHERE occ_id IS NOT NULL AND occ_id > $1 AND occ_timestamp >= now() - interval '40 days'
            ORDER BY occ_id LIMIT $2`, [cursor, BATCH])).rows;
        if (rows.length === 0) break;
        for (const r of rows) {
          try {
            granted += await updateChallengesForMember(this.pool, r.occ_id);
            granted += await processReferralReward(this.pool, r.occ_id);
            members++;
          } catch { /* fail-safe per member */ }
          cursor = r.occ_id;
        }
        if (rows.length < BATCH) break;
      }
      granted += await grantBirthdayBonus(this.pool);
      if (granted > 0) this.log.log(`campaign: ${members} khách, thưởng ${granted} điểm`);
      return { members, granted };
    } catch (err) {
      this.log.error(`campaign lỗi: ${err instanceof Error ? err.message : err}`);
      return { members: 0, granted: 0 };
    }
  }
}
