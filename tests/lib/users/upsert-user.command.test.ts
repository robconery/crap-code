import type { Database } from "bun:sqlite";
/**
 * Integration tests for UpsertUserCommand.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 3 AC4, Story 5 AC4, Story 6 AC1.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Logger } from "@/lib/infra/logger";
import { UpsertUserCommand } from "@/lib/users/upsert-user.command";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");

// ─── Scenario: no user exists for the email ──────────────────────────────────

describe("UpsertUserCommand", () => {
  describe("when no User exists for the given email", () => {
    let testDb: TestDb;
    let cmd: UpsertUserCommand;

    beforeEach(() => {
      testDb = createTestDb();
      cmd = new UpsertUserCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("creates a User record with email, name, and stripe_customer_id", async () => {
      // AC 3.4 / AC 6.1
      const user = await cmd.execute({
        email: "rob@example.com",
        name: "Rob Conery",
        stripeCustomerId: "cus_test_001",
      });

      expect(user.email).toBe("rob@example.com");
      expect(user.name).toBe("Rob Conery");
      expect(user.stripeCustomerId).toBe("cus_test_001");
    });

    it("stores only one row in the users table", async () => {
      await cmd.execute({ email: "rob@example.com", name: "Rob Conery" });

      const count = testDb.sqlite.query("SELECT COUNT(*) as cnt FROM users").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });
  });

  // ─── Scenario: user already exists with the same email ───────────────────

  describe("when a User already exists with the same email", () => {
    let testDb: TestDb;
    let cmd: UpsertUserCommand;

    beforeEach(async () => {
      testDb = createTestDb();
      cmd = new UpsertUserCommand(testDb.db, logger);
      // Arrange: seed an existing user
      await cmd.execute({ email: "rob@example.com", name: "Rob" });
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the existing User without creating a duplicate row (email is conflict key)", async () => {
      // AC 5.4
      await cmd.execute({ email: "rob@example.com", name: "Rob Conery" });

      const count = testDb.sqlite.query("SELECT COUNT(*) as cnt FROM users").get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(1);
    });

    it("updates the name on the existing User record", async () => {
      const updated = await cmd.execute({ email: "rob@example.com", name: "Rob Conery" });

      expect(updated.name).toBe("Rob Conery");
    });

    it("stores stripe_customer_id on the existing User record when provided", async () => {
      // AC 6.1
      const updated = await cmd.execute({
        email: "rob@example.com",
        stripeCustomerId: "cus_test_001",
      });

      expect(updated.stripeCustomerId).toBe("cus_test_001");
    });
  });
});
