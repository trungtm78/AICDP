import { Redis } from "ioredis";

// Redis client cho Real-time Personalization (cache profile + reco). lazyConnect + retry thấp
// để KHÔNG chặn boot/khi Redis down; rt.service bắt lỗi -> fallback Postgres (cache-aside).

export const REDIS = Symbol("REDIS");

let client: Redis | null = null;

export function getRedis(): Redis {
  if (!client) {
    client = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: (times: number) => (times > 3 ? null : 200),
    });
    // Nuốt lỗi kết nối để không làm sập process (rt.service tự fallback PG).
    client.on("error", () => { /* silent: fallback PG */ });
  }
  return client;
}

export const redisProvider = {
  provide: REDIS,
  useFactory: (): Redis => getRedis(),
};
