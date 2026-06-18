import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { chReachable, testCh, setupTestCh, truncateCh } from "../test-helpers/ch.js";
import {
  insertTransaction,
  getTxAggregate,
  getRevenueByBrand,
  toChDateTime,
  type TransactionRow,
} from "./clickhouse.repo.js";

// Tự skip khi ClickHouse không kết nối được (vd Docker chưa lên) -> suite vẫn xanh.
const CH_UP = await chReachable();

function row(p: Partial<TransactionRow> & { message_id: string; brand_id: string; total: number }): TransactionRow {
  return {
    occ_id: "",
    store_id: "s1",
    source: "pos",
    pos_transaction_id: p.message_id,
    currency: "VND",
    occ_timestamp: toChDateTime("2026-06-18T03:00:00.000Z"),
    ...p,
  };
}

describe.skipIf(!CH_UP)("clickhouse.repo (OLAP)", () => {
  beforeAll(async () => {
    await setupTestCh();
  });
  beforeEach(async () => {
    await truncateCh();
  });

  it("insert rồi tổng hợp count + revenue", async () => {
    await insertTransaction(testCh(), row({ message_id: "givral:s1:T1", brand_id: "givral", total: 250000 }));
    await insertTransaction(testCh(), row({ message_id: "givral:s1:T2", brand_id: "givral", total: 100000 }));
    const agg = await getTxAggregate(testCh());
    expect(agg.transactions).toBe(2);
    expect(agg.revenue).toBe(350000);
  });

  it("re-project cùng message_id KHÔNG nhân đôi (ReplacingMergeTree + FINAL)", async () => {
    const r = row({ message_id: "givral:s1:DUP", brand_id: "givral", total: 50000 });
    await insertTransaction(testCh(), r);
    await insertTransaction(testCh(), { ...r, occ_timestamp: toChDateTime("2026-06-18T04:00:00.000Z") });
    const agg = await getTxAggregate(testCh());
    expect(agg.transactions).toBe(1); // dedup theo message_id
    expect(agg.revenue).toBe(50000);
  });

  it("doanh thu theo thương hiệu (group-by OLAP), sắp xếp giảm dần", async () => {
    await insertTransaction(testCh(), row({ message_id: "givral:s1:A", brand_id: "givral", total: 300000 }));
    await insertTransaction(testCh(), row({ message_id: "ktt:s1:B", brand_id: "kem-trang-tien", total: 500000 }));
    await insertTransaction(testCh(), row({ message_id: "givral:s1:C", brand_id: "givral", total: 100000 }));
    const byBrand = await getRevenueByBrand(testCh());
    expect(byBrand[0]).toEqual({ brandId: "kem-trang-tien", revenue: 500000, transactions: 1 });
    const givral = byBrand.find((b) => b.brandId === "givral")!;
    expect(givral.revenue).toBe(400000);
    expect(givral.transactions).toBe(2);
  });
});
