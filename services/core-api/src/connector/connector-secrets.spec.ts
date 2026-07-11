import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { isEncrypted } from "./secrets.js";
import {
  createConnection, listConnections, getConnectionConfigDecrypted, secretFieldsFor, createConnector,
} from "./connector.service.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

describe("connector.service · mã hoá secret (vá lỗ hổng plaintext)", () => {
  it("createConnection mã hoá field secret; trả về API đã MASK (không plaintext)", async () => {
    const c = await createConnection(pool, {
      name: "Zalo demo", direction: "destination", connectorKey: "dst_zalo_zns",
      config: { oaId: "oa-001", apiKey: "zalo-secret-9999", templateId: "tpl-1" },
    });
    expect(c.config.apiKey).toBe("••••9999"); // mask + hint
    expect(c.config.oaId).toBe("oa-001");      // field thường giữ nguyên
    expect(JSON.stringify(c.config)).not.toContain("zalo-secret");
  });

  it("DB lưu ciphertext (không plaintext); listConnections cũng mask", async () => {
    await createConnection(pool, {
      name: "z", direction: "destination", connectorKey: "dst_zalo_zns",
      config: { apiKey: "zalo-secret-9999" },
    });
    const raw = await pool.query<{ config: Record<string, unknown> }>("SELECT config FROM cdp.connection");
    expect(isEncrypted(raw.rows[0]!.config.apiKey)).toBe(true);

    const list = await listConnections(pool);
    expect(JSON.stringify(list)).not.toContain("zalo-secret-9999");
    expect(list[0]!.config.apiKey).toBe("••••9999");
  });

  it("getConnectionConfigDecrypted khôi phục plaintext cho dùng nội bộ", async () => {
    const c = await createConnection(pool, {
      name: "z", direction: "destination", connectorKey: "dst_zalo_zns",
      config: { oaId: "oa-1", apiKey: "zalo-secret-9999" },
    });
    const dec = await getConnectionConfigDecrypted(pool, c.id);
    expect(dec?.config.apiKey).toBe("zalo-secret-9999");
    expect(dec?.config.oaId).toBe("oa-1");
    expect(dec?.connectorKey).toBe("dst_zalo_zns");
  });

  it("getConnectionConfigDecrypted trả null khi không tồn tại", async () => {
    expect(await getConnectionConfigDecrypted(pool, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("secretFieldsFor: catalog (dst_zalo_zns -> apiKey) và custom connector (config_schema)", async () => {
    expect(await secretFieldsFor(pool, "dst_zalo_zns")).toContain("apiKey");
    expect(await secretFieldsFor(pool, "src_webhook")).toEqual([]); // không có field secret
    await createConnector(pool, {
      key: "custom_x", name: "Custom", direction: "destination", category: "c", transport: "rest",
      configSchema: [{ key: "token", label: "Token", type: "password", secret: true }, { key: "url", label: "URL", type: "url" }],
    });
    expect(await secretFieldsFor(pool, "custom_x")).toEqual(["token"]);
  });
});
