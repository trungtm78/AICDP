import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";
import { recordConsent, getConsent, isAllowed, listConsents } from "./consent.service.js";

let occId: string;

beforeAll(async () => {
  await setupTestDb();
});
beforeEach(async () => {
  await truncateAll();
  const r = await pool.query<{ occ_id: string }>(
    "INSERT INTO cdp.occ_identity DEFAULT VALUES RETURNING occ_id",
  );
  occId = r.rows[0]!.occ_id;
});

describe("consent — deny-by-default", () => {
  it("không có bản ghi -> isAllowed = false, getConsent = denied", async () => {
    expect(await isAllowed(pool, occId, "marketing_email")).toBe(false);
    expect((await getConsent(pool, occId, "marketing_email")).status).toBe("denied");
  });

  it("grant -> isAllowed = true", async () => {
    await recordConsent(pool, {
      occId,
      purpose: "marketing_email",
      status: "granted",
      source: "web",
    });
    expect(await isAllowed(pool, occId, "marketing_email")).toBe(true);
  });

  it("withdraw sau grant -> latest-wins -> isAllowed = false", async () => {
    await recordConsent(pool, { occId, purpose: "marketing_sms", status: "granted", source: "pos" });
    await recordConsent(pool, { occId, purpose: "marketing_sms", status: "withdrawn", source: "csr" });
    expect(await isAllowed(pool, occId, "marketing_sms")).toBe(false);
  });

  it("re-grant sau withdraw -> isAllowed = true (audit giữ mọi bản ghi)", async () => {
    await recordConsent(pool, { occId, purpose: "personalization", status: "granted", source: "web" });
    await recordConsent(pool, { occId, purpose: "personalization", status: "withdrawn", source: "web" });
    await recordConsent(pool, { occId, purpose: "personalization", status: "granted", source: "web" });
    expect(await isAllowed(pool, occId, "personalization")).toBe(true);

    const audit = await pool.query<{ n: string }>(
      "SELECT count(*)::int AS n FROM cdp.consent_record WHERE occ_id=$1 AND purpose=$2",
      [occId, "personalization"],
    );
    expect(Number(audit.rows[0]!.n)).toBe(3); // append-only, không xóa lịch sử
  });

  it("append-only: UPDATE/DELETE bản ghi consent bị DB chặn (audit bất biến)", async () => {
    await recordConsent(pool, { occId, purpose: "data_sharing", status: "granted", source: "web" });
    await expect(
      pool.query("UPDATE cdp.consent_record SET status='withdrawn' WHERE occ_id=$1", [occId]),
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query("DELETE FROM cdp.consent_record WHERE occ_id=$1", [occId]),
    ).rejects.toThrow(/append-only/i);
  });

  it("listConsents trả trạng thái hiện tại theo từng purpose", async () => {
    await recordConsent(pool, { occId, purpose: "marketing_email", status: "granted", source: "web" });
    await recordConsent(pool, { occId, purpose: "marketing_sms", status: "granted", source: "web" });
    await recordConsent(pool, { occId, purpose: "marketing_sms", status: "withdrawn", source: "web" });

    const list = await listConsents(pool, occId);
    const byPurpose = Object.fromEntries(list.map((c) => [c.purpose, c.status]));
    expect(byPurpose["marketing_email"]).toBe("granted");
    expect(byPurpose["marketing_sms"]).toBe("withdrawn");
  });
});
