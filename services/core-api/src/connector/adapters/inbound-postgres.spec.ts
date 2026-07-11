import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { postgresInboundAdapter, resolvePinnedHost } from "./inbound-postgres.js";
import { AppError } from "../../http/errors.js";

// Kiểm nhánh BẢO MẬT của adapter reverse-ETL (ném TRƯỚC khi mở kết nối DB — không cần DB thật).
const base = {
  host: "127.0.0.1", port: 5433, database: "x", user: "u", apiKey: "p",
  table: "cdp.orders", cursorColumn: "id",
  mapping: { pos_transaction_id: "txn", total: "amt" },
};

describe("postgresInboundAdapter — host guard + SELECT-only", () => {
  const prev = process.env.CONNECTOR_ALLOW_PRIVATE_PULL;
  beforeEach(() => { delete process.env.CONNECTOR_ALLOW_PRIVATE_PULL; });
  afterEach(() => {
    if (prev === undefined) delete process.env.CONNECTOR_ALLOW_PRIVATE_PULL;
    else process.env.CONNECTOR_ALLOW_PRIVATE_PULL = prev;
  });

  it("chặn kết nối tới IP nội bộ (SSRF) -> CONNECTOR_URL_BLOCKED", async () => {
    await expect(postgresInboundAdapter.pull(base, null)).rejects.toMatchObject({ code: "CONNECTOR_URL_BLOCKED" });
  });

  it("thiếu host -> CONNECTOR_MISCONFIGURED", async () => {
    await expect(postgresInboundAdapter.pull({ ...base, host: "" }, null)).rejects.toBeInstanceOf(AppError);
    await expect(postgresInboundAdapter.pull({ ...base, host: "" }, null)).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("identifier bảng có ký tự lạ (SQL injection) -> CONNECTOR_MISCONFIGURED", async () => {
    process.env.CONNECTOR_ALLOW_PRIVATE_PULL = "1"; // qua host guard để tới bước validate identifier
    await expect(
      postgresInboundAdapter.pull({ ...base, table: "orders; DROP TABLE users" }, null),
    ).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("thiếu mapping.total -> CONNECTOR_MISCONFIGURED", async () => {
    process.env.CONNECTOR_ALLOW_PRIVATE_PULL = "1";
    await expect(
      postgresInboundAdapter.pull({ ...base, mapping: { pos_transaction_id: "txn" } }, null),
    ).rejects.toMatchObject({ code: "CONNECTOR_MISCONFIGURED" });
  });

  it("host không resolve được -> CONNECTOR_URL_BLOCKED", async () => {
    await expect(
      postgresInboundAdapter.pull({ ...base, host: "nonexistent-host.invalid" }, null),
    ).rejects.toMatchObject({ code: "CONNECTOR_URL_BLOCKED" });
  });
});

describe("resolvePinnedHost — chống DNS-rebinding (resolve-then-pin)", () => {
  const prev = process.env.CONNECTOR_ALLOW_PRIVATE_PULL;
  afterEach(() => {
    if (prev === undefined) delete process.env.CONNECTOR_ALLOW_PRIVATE_PULL;
    else process.env.CONNECTOR_ALLOW_PRIVATE_PULL = prev;
  });

  it("hostname công khai -> PIN về IP đã validate (pg không resolve lại)", async () => {
    const pinned = await resolvePinnedHost("db.example.com", {
      lookup: async () => ["93.184.216.34"], allowPrivate: false,
    });
    expect(pinned).toBe("93.184.216.34");
  });

  it("hostname trỏ IP nội bộ (rebinding) -> chặn CONNECTOR_URL_BLOCKED", async () => {
    await expect(
      resolvePinnedHost("evil-twin.example.com", { lookup: async () => ["10.0.0.5"], allowPrivate: false }),
    ).rejects.toMatchObject({ code: "CONNECTOR_URL_BLOCKED" });
  });

  it("một IP công khai + một IP nội bộ -> chặn (kiểm mọi bản ghi)", async () => {
    await expect(
      resolvePinnedHost("mixed.example.com", { lookup: async () => ["1.2.3.4", "127.0.0.1"], allowPrivate: false }),
    ).rejects.toMatchObject({ code: "CONNECTOR_URL_BLOCKED" });
  });

  it("IP literal nội bộ + không allow -> chặn", async () => {
    await expect(resolvePinnedHost("127.0.0.1", { allowPrivate: false })).rejects.toMatchObject({
      code: "CONNECTOR_URL_BLOCKED",
    });
  });

  it("IP literal + allow -> trả về chính nó", async () => {
    expect(await resolvePinnedHost("127.0.0.1", { allowPrivate: true })).toBe("127.0.0.1");
  });

  it("IP literal công khai -> trả về chính nó (không cần lookup)", async () => {
    expect(await resolvePinnedHost("8.8.8.8", { allowPrivate: false })).toBe("8.8.8.8");
  });

  it("allowPrivate + hostname -> trả nguyên hostname (self-host tin kho nội bộ)", async () => {
    expect(await resolvePinnedHost("warehouse.internal", { allowPrivate: true })).toBe("warehouse.internal");
  });
});
