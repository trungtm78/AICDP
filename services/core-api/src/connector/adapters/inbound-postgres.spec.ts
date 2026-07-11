import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { postgresInboundAdapter } from "./inbound-postgres.js";
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
