import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestIdentify, ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeAllFeatures } from "../feature/feature.service.js";
import { listCustomers } from "./customers.repo.js";

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
});

// Seed một khách: identify (điền profile) + N đơn (mỗi đơn total tăng monetary).
// Trả occId để test có thể thao tác trực tiếp (vd đánh dấu merged).
async function seedCustomer(opts: {
  brandId: string;
  storeId: string;
  fullName: string;
  phone: string;
  email: string;
  city: string;
  total: number;
  txnPrefix: string;
}): Promise<string> {
  await ingestIdentify(pool, {
    brand_id: opts.brandId,
    identifiers: [
      { type: "phone", value: opts.phone },
      { type: "email", value: opts.email },
    ],
    traits: {
      full_name: opts.fullName,
      phone: opts.phone,
      email: opts.email,
      city: opts.city,
    },
  });
  const res = await ingestOrderCompleted(pool, {
    brand_id: opts.brandId,
    store_id: opts.storeId,
    source: "pos",
    occ_timestamp: "2026-07-01T04:00:00.000Z",
    identifiers: [
      { type: "phone", value: opts.phone },
      { type: "email", value: opts.email },
    ],
    properties: {
      pos_transaction_id: opts.txnPrefix,
      currency: "VND",
      total: opts.total,
      payment_method: "cash",
      business_date: "2026-07-01",
      items: [],
    },
  });
  return res.occId!;
}

// Cần store hợp lệ (FK brand givral có sẵn reference data).
async function seedStore(): Promise<void> {
  await pool.query(
    `INSERT INTO cdp.store (store_id, brand_id, name) VALUES ('givral-q1','givral','Givral Q1')
     ON CONFLICT (store_id) DO NOTHING`,
  );
}

describe("customers.repo — listCustomers", () => {
  it("liệt kê khách active + sắp xếp theo monetary giảm dần", async () => {
    await seedStore();
    await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Nguyễn Văn An",
      phone: "0900000001",
      email: "an@example.com",
      city: "TP.HCM",
      total: 100000,
      txnPrefix: "T-AN",
    });
    await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Trần Thị Bình",
      phone: "0900000002",
      email: "binh@example.com",
      city: "Hà Nội",
      total: 500000,
      txnPrefix: "T-BINH",
    });
    await recomputeAllFeatures(pool);

    const { rows, total } = await listCustomers(pool, {});
    expect(total).toBe(2);
    expect(rows.length).toBe(2);
    // Bình chi 500k > An 100k -> đứng trước.
    expect(rows[0]!.fullName).toBe("Trần Thị Bình");
    expect(rows[0]!.monetary).toBe(500000);
    expect(typeof rows[0]!.monetary).toBe("number");
    expect(rows[1]!.fullName).toBe("Nguyễn Văn An");
  });

  it("search khớp theo tên", async () => {
    await seedStore();
    await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Nguyễn Văn An",
      phone: "0900000001",
      email: "an@example.com",
      city: "TP.HCM",
      total: 100000,
      txnPrefix: "T-AN",
    });
    await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Trần Thị Bình",
      phone: "0900000002",
      email: "binh@example.com",
      city: "Hà Nội",
      total: 500000,
      txnPrefix: "T-BINH",
    });
    await recomputeAllFeatures(pool);

    const byName = await listCustomers(pool, { search: "Bình" });
    expect(byName.total).toBe(1);
    expect(byName.rows[0]!.fullName).toBe("Trần Thị Bình");
  });

  it("search khớp theo identifier (số điện thoại)", async () => {
    await seedStore();
    await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Nguyễn Văn An",
      phone: "0900000001",
      email: "an@example.com",
      city: "TP.HCM",
      total: 100000,
      txnPrefix: "T-AN",
    });
    await recomputeAllFeatures(pool);

    // Phone lưu ở dạng chuẩn hoá +84900000001 -> search khớp trên value_normalized.
    const byPhone = await listCustomers(pool, { search: "84900000001" });
    expect(byPhone.total).toBe(1);
    expect(byPhone.rows[0]!.fullName).toBe("Nguyễn Văn An");
  });

  it("lọc theo lifecycle_stage", async () => {
    await seedStore();
    const occId = await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Nguyễn Văn An",
      phone: "0900000001",
      email: "an@example.com",
      city: "TP.HCM",
      total: 100000,
      txnPrefix: "T-AN",
    });
    await recomputeAllFeatures(pool);
    // Ép lifecycle_stage cụ thể để test filter (không phụ thuộc heuristic).
    await pool.query(`UPDATE cdp.customer_feature SET lifecycle_stage='vip' WHERE occ_id=$1`, [
      occId,
    ]);

    const vip = await listCustomers(pool, { lifecycle: "vip" });
    expect(vip.total).toBe(1);
    expect(vip.rows[0]!.lifecycleStage).toBe("vip");

    const dormant = await listCustomers(pool, { lifecycle: "dormant" });
    expect(dormant.total).toBe(0);
  });

  it("phân trang bằng limit/offset (total giữ nguyên tổng)", async () => {
    await seedStore();
    for (let i = 1; i <= 3; i++) {
      await seedCustomer({
        brandId: "givral",
        storeId: "givral-q1",
        fullName: `Khách ${i}`,
        phone: `090000010${i}`,
        email: `k${i}@example.com`,
        city: "TP.HCM",
        total: i * 100000, // monetary tăng dần -> thứ tự giảm dần: k3, k2, k1
        txnPrefix: `T-K${i}`,
      });
    }
    await recomputeAllFeatures(pool);

    const page1 = await listCustomers(pool, { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.rows.length).toBe(2);
    expect(page1.rows[0]!.fullName).toBe("Khách 3");
    expect(page1.rows[1]!.fullName).toBe("Khách 2");

    const page2 = await listCustomers(pool, { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.rows.length).toBe(1);
    expect(page2.rows[0]!.fullName).toBe("Khách 1");
  });

  it("KHÔNG trả khách đã bị hợp nhất (merged_into)", async () => {
    await seedStore();
    const survivor = await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Nguyễn Văn An",
      phone: "0900000001",
      email: "an@example.com",
      city: "TP.HCM",
      total: 100000,
      txnPrefix: "T-AN",
    });
    const merged = await seedCustomer({
      brandId: "givral",
      storeId: "givral-q1",
      fullName: "Trần Thị Bình",
      phone: "0900000002",
      email: "binh@example.com",
      city: "Hà Nội",
      total: 500000,
      txnPrefix: "T-BINH",
    });
    await recomputeAllFeatures(pool);
    // Đánh dấu 'merged' đã hợp nhất vào 'survivor'.
    await pool.query(
      `UPDATE cdp.occ_identity SET merged_into=$1, status='merged' WHERE occ_id=$2`,
      [survivor, merged],
    );

    const { rows, total } = await listCustomers(pool, {});
    expect(total).toBe(1);
    expect(rows.map((r) => r.occId)).toEqual([survivor]);
  });
});
