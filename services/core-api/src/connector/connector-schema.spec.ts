import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { pool } from "../db/pool.js";
import { setupTestDb, truncateAll } from "../test-helpers/db.js";

beforeAll(async () => { await setupTestDb(); });
beforeEach(async () => { await truncateAll(); });

async function newConnection(direction = "destination"): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO cdp.connection (name, direction, connector_key) VALUES ('t',$1,'dst_webhook') RETURNING id`,
    [direction],
  );
  return r.rows[0]!.id;
}

describe("migration 024 · connector_live schema", () => {
  it("connection có cột vận hành thật (token/oauth/health/cursor)", async () => {
    const id = await newConnection();
    await pool.query(
      `UPDATE cdp.connection SET inbound_token_hash=$2, oauth_state=$3::jsonb,
          last_checked_at=now(), last_error='x', pull_cursor=$4::jsonb WHERE id=$1`,
      [id, "hash", JSON.stringify({ expires_at: 1 }), JSON.stringify({ last: 5 })],
    );
    const r = await pool.query<{ inbound_token_hash: string; last_error: string }>(
      `SELECT inbound_token_hash, last_error FROM cdp.connection WHERE id=$1`, [id],
    );
    expect(r.rows[0]!.inbound_token_hash).toBe("hash");
    expect(r.rows[0]!.last_error).toBe("x");
  });

  it("connector_event ghi được + CHECK status", async () => {
    const id = await newConnection("source");
    await pool.query(
      `INSERT INTO cdp.connector_event (connection_id, event_type, message_id, status) VALUES ($1,'order_completed','m1','ingested')`,
      [id],
    );
    const c = await pool.query(`SELECT status FROM cdp.connector_event WHERE connection_id=$1`, [id]);
    expect(c.rows[0]!.status).toBe("ingested");
    await expect(
      pool.query(`INSERT INTO cdp.connector_event (connection_id, event_type, status) VALUES ($1,'x','bogus')`, [id]),
    ).rejects.toThrow();
  });

  it("connector_delivery ghi được + CHECK status + attempts mặc định 1", async () => {
    const id = await newConnection();
    await pool.query(
      `INSERT INTO cdp.connector_delivery (connection_id, channel, recipient, status) VALUES ($1,'webhook','https://x.test','sent')`,
      [id],
    );
    const c = await pool.query<{ status: string; attempts: number }>(
      `SELECT status, attempts FROM cdp.connector_delivery WHERE connection_id=$1`, [id],
    );
    expect(c.rows[0]!.status).toBe("sent");
    expect(c.rows[0]!.attempts).toBe(1);
    await expect(
      pool.query(`INSERT INTO cdp.connector_delivery (connection_id, channel, status) VALUES ($1,'webhook','bogus')`, [id]),
    ).rejects.toThrow();
  });

  it("xoá connection -> cascade xoá event + delivery", async () => {
    const id = await newConnection("source");
    await pool.query(`INSERT INTO cdp.connector_event (connection_id, event_type, status) VALUES ($1,'identify','ingested')`, [id]);
    await pool.query(`INSERT INTO cdp.connector_delivery (connection_id, channel, status) VALUES ($1,'webhook','sent')`, [id]);
    await pool.query(`DELETE FROM cdp.connection WHERE id=$1`, [id]);
    const ev = await pool.query(`SELECT 1 FROM cdp.connector_event WHERE connection_id=$1`, [id]);
    const dl = await pool.query(`SELECT 1 FROM cdp.connector_delivery WHERE connection_id=$1`, [id]);
    expect(ev.rowCount).toBe(0);
    expect(dl.rowCount).toBe(0);
  });
});
