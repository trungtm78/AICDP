import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Redis } from "ioredis";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { ingestOrderCompleted } from "../ingestion/ingestion.service.js";
import { recomputeFeature } from "../feature/feature.service.js";
import { getProfile, getReco, redisStatus } from "./rt.service.js";

// Fake Redis in-memory (cache-aside) + Redis "down" (mọi lệnh ném) để test fallback PG.
class FakeRedis {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async set(k: string, v: string) { this.store.set(k, v); return "OK"; }
  async ping() { return "PONG"; }
  async dbsize() { return this.store.size; }
}
class DownRedis {
  async get(): Promise<string | null> { throw new Error("redis down"); }
  async set(): Promise<string> { throw new Error("redis down"); }
  async ping(): Promise<string> { throw new Error("redis down"); }
  async dbsize(): Promise<number> { throw new Error("redis down"); }
}
const asRedis = (x: unknown) => x as unknown as Redis;

let occId: string;
beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => {
  await truncateAll();
  const r = await ingestOrderCompleted(pool, {
    brand_id: "givral", store_id: "s1", source: "pos", occ_timestamp: "2026-01-01T00:00:00Z",
    identifiers: [{ type: "phone", value: "0901000001" }],
    properties: { pos_transaction_id: "t1", total: 500000 },
  });
  occId = r.occId!;
  await recomputeFeature(pool, occId);
});

describe("rt.service — cache-aside + fallback", () => {
  it("profile: miss lần đầu (từ PG, set cache), hit lần 2 (từ Redis)", async () => {
    const redis = new FakeRedis();
    const r1 = await getProfile(pool, asRedis(redis), occId);
    expect(r1.cacheHit).toBe(false);
    expect(r1.data?.occId).toBe(occId);
    expect(redis.store.has(`profile:${occId}`)).toBe(true);

    const r2 = await getProfile(pool, asRedis(redis), occId);
    expect(r2.cacheHit).toBe(true);
    expect(r2.data?.occId).toBe(occId);
  });

  it("profile: Redis DOWN -> fallback PG, KHÔNG crash, cacheHit=false", async () => {
    const r = await getProfile(pool, asRedis(new DownRedis()), occId);
    expect(r.cacheHit).toBe(false);
    expect(r.data?.occId).toBe(occId); // vẫn trả dữ liệu từ Postgres
  });

  it("reco: miss -> tính recommendV2 + set cache; Redis down vẫn trả (fallback PG)", async () => {
    const redis = new FakeRedis();
    const r = await getReco(pool, asRedis(redis), occId);
    expect(r.cacheHit).toBe(false);
    expect(Array.isArray(r.data)).toBe(true);
    const down = await getReco(pool, asRedis(new DownRedis()), occId);
    expect(down.cacheHit).toBe(false);
    expect(Array.isArray(down.data)).toBe(true);
  });

  it("redisStatus: up khi ping OK, down khi ném", async () => {
    expect((await redisStatus(asRedis(new FakeRedis()))).up).toBe(true);
    expect((await redisStatus(asRedis(new DownRedis()))).up).toBe(false);
  });
});
