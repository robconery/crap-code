/**
 * Integration tests for UpsertSubscriptionCommand.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 6 AC2, AC3, AC4 — subscription creation and idempotency.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Logger } from "@/lib/infra/logger";
import { UpsertSubscriptionCommand } from "@/lib/subscriptions/upsert-subscription.command";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");

const BASE_INPUT = {
  stripeSubscriptionId: "sub_test_ABC123",
  userId: 1,
  status: "active",
};

/** Seeds a user row so FK constraints on subscriptions are satisfied. */
function seedUser(sqlite: TestDb["sqlite"]): void {
  sqlite.run(
    "INSERT INTO users (email, name, stripe_customer_id, created_at) VALUES ('rob@example.com', 'Rob Conery', 'cus_001', '2024-01-15T10:00:00.000Z')"
  );
}

// ─── Scenario: no subscription exists yet ────────────────────────────────────

describe("UpsertSubscriptionCommand", () => {
  describe("when no Subscription exists for the given stripe_subscription_id", () => {
    let testDb: TestDb;
    let cmd: UpsertSubscriptionCommand;

    beforeEach(() => {
      testDb = createTestDb();
      seedUser(testDb.sqlite);
      cmd = new UpsertSubscriptionCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("creates a Subscription record linked to the User", async () => {
      // AC 6.2
      const { subscription, created } = await cmd.execute(BASE_INPUT);

      expect(subscription.stripeSubscriptionId).toBe(BASE_INPUT.stripeSubscriptionId);
      expect(subscription.userId).toBe(BASE_INPUT.userId);
      expect(subscription.status).toBe("active");
      expect(created).toBe(true);
    });

    it("stores only stripe_subscription_id, status, and user_id — no billing details", async () => {
      // AC 6.4 — local record holds only access-authorization fields
      const { subscription } = await cmd.execute(BASE_INPUT);

      const keys = Object.keys(subscription);
      expect(keys).toContain("stripeSubscriptionId");
      expect(keys).toContain("userId");
      expect(keys).toContain("status");
      expect(keys).not.toContain("amountDue");
      expect(keys).not.toContain("planId");
      expect(keys).not.toContain("invoiceId");
    });
  });

  // ─── Scenario: subscription already exists (idempotent re-payment) ────────

  describe("when a Subscription already exists for the same stripe_subscription_id", () => {
    let testDb: TestDb;
    let cmd: UpsertSubscriptionCommand;

    beforeEach(async () => {
      testDb = createTestDb();
      seedUser(testDb.sqlite);
      cmd = new UpsertSubscriptionCommand(testDb.db, logger);
      // Arrange: first payment already created the subscription
      await cmd.execute(BASE_INPUT);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("does not create a duplicate Subscription row (idempotent)", async () => {
      // AC 6.3
      const { created } = await cmd.execute(BASE_INPUT);

      const count = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM subscriptions").get() as { c: number }
      ).c;
      expect(count).toBe(1);
      expect(created).toBe(false);
    });
  });
});
