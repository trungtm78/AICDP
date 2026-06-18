import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { forecastRevenue } from "./forecast.service.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

let txn = 0;
function order(brand: string, ts: string, total: number) {
  txn++;
  return {
    brand_id: brand, store_id: "s1", source: "pos", occ_timestamp: ts,
    identifiers: [{ type: "phone", value: "0901234567" }],
    properties: { pos_transaction_id: `F-${txn}`, total, items: [] },
  };
}
const ing = (o: unknown) => ingestOrderCompleted(pool, o as never);

describe("forecast — heuristic moving-average + trend", () => {
  it("không có dữ liệu -> history rỗng, forecast rỗng", async () => {
    const f = await forecastRevenue(pool, { granularity: "week", periods: 4 });
    expect(f.history).toEqual([]);
    expect(f.forecast).toEqual([]);
    expect(f.method).toBe("heuristic-ma");
  });

  it("gom doanh thu theo tuần và dự báo đúng số kỳ", async () => {
    // 3 tuần dữ liệu, mỗi tuần 1 đơn tăng dần
    await ing(order("givral", "2026-05-04T03:00:00.000Z", 100000));
    await ing(order("givral", "2026-05-11T03:00:00.000Z", 200000));
    await ing(order("givral", "2026-05-18T03:00:00.000Z", 300000));
    const f = await forecastRevenue(pool, { granularity: "week", periods: 3, window: 3 });
    expect(f.history.length).toBe(3);
    expect(f.history[0]!.revenue).toBe(100000);
    expect(f.forecast.length).toBe(3);
    // xu hướng tăng -> dự báo > 0 và không âm
    expect(f.forecast.every((p) => p.revenue >= 0)).toBe(true);
    // forecast đầu tiên >= baseline (xu hướng dương)
    expect(f.forecast[0]!.revenue).toBeGreaterThan(0);
  });

  it("lọc theo brandId chỉ tính giao dịch brand đó", async () => {
    await ing(order("givral", "2026-05-04T03:00:00.000Z", 100000));
    await ing(order("kem_trang_tien", "2026-05-04T03:00:00.000Z", 999000));
    const f = await forecastRevenue(pool, { brandId: "givral", granularity: "week", periods: 1 });
    expect(f.brandId).toBe("givral");
    expect(f.history.reduce((a, b) => a + b.revenue, 0)).toBe(100000);
  });

  it("dự báo kỳ kế tiếp nối đúng mốc thời gian (tuần +7 ngày)", async () => {
    await ing(order("givral", "2026-05-04T03:00:00.000Z", 100000));
    await ing(order("givral", "2026-05-11T03:00:00.000Z", 120000));
    const f = await forecastRevenue(pool, { granularity: "week", periods: 1, window: 2 });
    // history cuối = tuần chứa 2026-05-11 (date_trunc week -> thứ Hai 2026-05-11)
    const lastHist = f.history[f.history.length - 1]!.period;
    const next = f.forecast[0]!.period;
    expect(new Date(next).getTime()).toBe(new Date(lastHist).getTime() + 7 * 86400000);
  });
});
