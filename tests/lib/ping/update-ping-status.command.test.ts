/**
 * Integration tests for UpdatePingStatusCommand.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 2 AC2, AC3 and the missing-ping sad path.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import { Logger } from "@/lib/infra/logger";
import { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");

/** Inserts a ping row and returns its auto-incremented id. */
function seedPing(sqlite: ReturnType<typeof createTestDb>["sqlite"], status = "received"): number {
  const now = new Date().toISOString();
  sqlite.run(
    `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
     VALUES ('evt_001', 'checkout.session.completed', '{}', ?, ?, ?)`,
    [status, now, now]
  );
  return (
    sqlite.query("SELECT id FROM pings WHERE stripe_event_id = 'evt_001'").get() as { id: number }
  ).id;
}

// ─── Scenario: processing completes successfully ──────────────────────────────

describe("UpdatePingStatusCommand", () => {
  describe("when processing completes successfully", () => {
    let testDb: TestDb;
    let cmd: UpdatePingStatusCommand;
    let pingId: number;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new UpdatePingStatusCommand(testDb.db, logger);
      pingId = seedPing(testDb.sqlite, "received");
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the Ping status to 'fulfilled'", async () => {
      // AC 2.2 — first transition in the happy path
      const result = await cmd.execute({ pingId, status: "fulfilled" });

      expect(result.status).toBe("fulfilled");
    });

    it("updates the Ping status to 'closed' after fulfillment", async () => {
      // AC 2.2 — second transition: fulfilled → closed
      await cmd.execute({ pingId, status: "fulfilled" });
      const result = await cmd.execute({ pingId, status: "closed" });

      expect(result.status).toBe("closed");
    });

    it("updates the updated_at timestamp", async () => {
      const before = new Date().toISOString();
      const result = await cmd.execute({ pingId, status: "fulfilled" });

      expect(result.updatedAt >= before).toBe(true);
    });
  });

  // ─── Scenario: a downstream step throws an error ─────────────────────────

  describe("when a downstream step throws an error", () => {
    let testDb: TestDb;
    let cmd: UpdatePingStatusCommand;
    let pingId: number;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new UpdatePingStatusCommand(testDb.db, logger);
      pingId = seedPing(testDb.sqlite, "received");
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the Ping status to 'error'", async () => {
      // AC 2.3
      const result = await cmd.execute({ pingId, status: "error" });

      expect(result.status).toBe("error");
    });
  });

  // ─── Scenario: the Ping record does not exist ────────────────────────────

  describe("when the Ping record does not exist", () => {
    let testDb: TestDb;
    let cmd: UpdatePingStatusCommand;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new UpdatePingStatusCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("throws a FulfillmentError rather than silently failing", async () => {
      // No silent failure — CLAUDE.md rule
      await expect(cmd.execute({ pingId: 99999, status: "closed" })).rejects.toBeInstanceOf(
        FulfillmentError
      );
    });
  });
});
