/**
 * Integration tests for SavePingCommand.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 2 AC1, AC4, AC5 and Story 8 AC5.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Logger } from "@/lib/infra/logger";
import { SavePingCommand } from "@/lib/ping/save-ping.command";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const TEST_EVENT_ID = "evt_test_ping_001";
const TEST_PAYLOAD = JSON.stringify({ id: TEST_EVENT_ID, type: "checkout.session.completed" });
const logger = new Logger("test-correlation-id");

const BASE_INPUT = {
  stripeEventId: TEST_EVENT_ID,
  eventType: "checkout.session.completed",
  rawPayload: TEST_PAYLOAD,
};

// ─── Scenario: fresh event arrives for the first time ────────────────────────

describe("SavePingCommand", () => {
  describe("when a verified Stripe event arrives for the first time", () => {
    let testDb: TestDb;
    let cmd: SavePingCommand;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new SavePingCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("saves a Ping record with status 'received'", async () => {
      // AC 2.1
      const { ping, shouldSkip } = await cmd.execute(BASE_INPUT);

      expect(shouldSkip).toBe(false);
      expect(ping.status).toBe("received");
    });

    it("stores the raw JSON payload on the Ping record", async () => {
      // AC 2.4
      const { ping } = await cmd.execute(BASE_INPUT);

      expect(ping.rawPayload).toBe(TEST_PAYLOAD);
    });

    it("stores the stripe_event_id and event_type on the Ping record", async () => {
      // AC 2.4
      const { ping } = await cmd.execute(BASE_INPUT);

      expect(ping.stripeEventId).toBe(TEST_EVENT_ID);
      expect(ping.eventType).toBe("checkout.session.completed");
    });

    it("inserts exactly one row into the pings table", async () => {
      await cmd.execute(BASE_INPUT);

      const count = testDb.sqlite.query("SELECT COUNT(*) as cnt FROM pings").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });
  });

  // ─── Scenario: duplicate event where existing ping is 'closed' ───────────

  describe("when the same stripe_event_id arrives and the existing Ping has status 'closed'", () => {
    let testDb: TestDb;
    let cmd: SavePingCommand;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new SavePingCommand(testDb.db, logger);
      // Arrange: seed a closed ping to simulate a duplicate
      const now = new Date().toISOString();
      testDb.sqlite.run(
        `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
         VALUES (?, ?, ?, 'closed', ?, ?)`,
        [TEST_EVENT_ID, "checkout.session.completed", TEST_PAYLOAD, now, now]
      );
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("returns shouldSkip=true", async () => {
      // AC 2.5
      const { shouldSkip } = await cmd.execute(BASE_INPUT);
      expect(shouldSkip).toBe(true);
    });

    it("returns the existing Ping with status 'closed'", async () => {
      const { ping } = await cmd.execute(BASE_INPUT);
      expect(ping.status).toBe("closed");
    });

    it("does not insert a duplicate row", async () => {
      await cmd.execute(BASE_INPUT);

      const count = testDb.sqlite.query("SELECT COUNT(*) as cnt FROM pings").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });
  });

  // ─── Scenario: duplicate event where existing ping is 'fulfilled' ─────────

  describe("when the same stripe_event_id arrives and the existing Ping has status 'fulfilled'", () => {
    let testDb: TestDb;
    let cmd: SavePingCommand;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new SavePingCommand(testDb.db, logger);
      const now = new Date().toISOString();
      testDb.sqlite.run(
        `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
         VALUES (?, ?, ?, 'fulfilled', ?, ?)`,
        [TEST_EVENT_ID, "checkout.session.completed", TEST_PAYLOAD, now, now]
      );
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("returns shouldSkip=true", async () => {
      // AC 2.5
      const { shouldSkip } = await cmd.execute(BASE_INPUT);
      expect(shouldSkip).toBe(true);
    });

    it("returns the existing Ping with status 'fulfilled'", async () => {
      const { ping } = await cmd.execute(BASE_INPUT);
      expect(ping.status).toBe("fulfilled");
    });
  });

  // ─── Scenario: duplicate event where existing ping is 'error' ────────────

  describe("when the same stripe_event_id arrives and the existing Ping has status 'error'", () => {
    let testDb: TestDb;
    let cmd: SavePingCommand;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new SavePingCommand(testDb.db, logger);
      // Arrange: seed an error ping — these must be re-processable (AC 8.5)
      const now = new Date().toISOString();
      testDb.sqlite.run(
        `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
         VALUES (?, ?, ?, 'error', ?, ?)`,
        [TEST_EVENT_ID, "checkout.session.completed", TEST_PAYLOAD, now, now]
      );
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("returns shouldSkip=false so the event is re-processed", async () => {
      // AC 8.5 — error pings must be re-processable, not skipped
      const { shouldSkip } = await cmd.execute(BASE_INPUT);
      expect(shouldSkip).toBe(false);
    });

    it("resets the Ping status back to 'received'", async () => {
      const { ping } = await cmd.execute(BASE_INPUT);
      expect(ping.status).toBe("received");
    });

    it("does not insert a duplicate row (reuses the existing ping row)", async () => {
      await cmd.execute(BASE_INPUT);

      const count = testDb.sqlite.query("SELECT COUNT(*) as cnt FROM pings").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });
  });
});
