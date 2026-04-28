/**
 * Integration tests for UpdateSubscriptionStatusCommand.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 7 AC1–AC5 — cancellation, update, renewal, and unknown-sub error.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { SubscriptionError } from "@/lib/errors/subscription.error";
import { Logger } from "@/lib/infra/logger";
import { UpdateSubscriptionStatusCommand } from "@/lib/subscriptions/update-subscription-status.command";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");
const STRIPE_SUB_ID = "sub_test_ABC123";

/** Seeds a user + active subscription so tests start from a known state. */
function seedUserAndSubscription(sqlite: TestDb["sqlite"]): void {
  sqlite.run(
    "INSERT INTO users (email, name, stripe_customer_id, created_at) VALUES ('rob@example.com', 'Rob Conery', 'cus_001', '2024-01-15T10:00:00.000Z')"
  );
  sqlite.run(
    `INSERT INTO subscriptions (stripe_subscription_id, user_id, status, created_at, updated_at)
     VALUES ('${STRIPE_SUB_ID}', 1, 'active', '2024-01-15T10:00:00.000Z', '2024-01-15T10:00:00.000Z')`
  );
}

// ─── Scenario: customer.subscription.deleted event ───────────────────────────

describe("UpdateSubscriptionStatusCommand", () => {
  describe("when a customer.subscription.deleted event is received", () => {
    let testDb: TestDb;
    let cmd: UpdateSubscriptionStatusCommand;

    beforeEach(() => {
      testDb = createTestDb();
      seedUserAndSubscription(testDb.sqlite);
      cmd = new UpdateSubscriptionStatusCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the local Subscription status to 'canceled'", async () => {
      // AC 7.1
      const updated = await cmd.execute({
        stripeSubscriptionId: STRIPE_SUB_ID,
        status: "canceled",
      });

      expect(updated.status).toBe("canceled");
    });

    it("does not delete or duplicate the associated User record", async () => {
      // AC 7.4
      await cmd.execute({ stripeSubscriptionId: STRIPE_SUB_ID, status: "canceled" });

      const userCount = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM users").get() as { c: number }
      ).c;
      expect(userCount).toBe(1);
    });
  });

  // ─── Scenario: customer.subscription.updated event ───────────────────────

  describe("when a customer.subscription.updated event is received", () => {
    let testDb: TestDb;
    let cmd: UpdateSubscriptionStatusCommand;

    beforeEach(() => {
      testDb = createTestDb();
      seedUserAndSubscription(testDb.sqlite);
      cmd = new UpdateSubscriptionStatusCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the local Subscription status to match the new Stripe status", async () => {
      // AC 7.2
      const updated = await cmd.execute({
        stripeSubscriptionId: STRIPE_SUB_ID,
        status: "past_due",
      });

      expect(updated.status).toBe("past_due");
    });

    it("does not delete or duplicate the associated User record", async () => {
      // AC 7.4
      await cmd.execute({ stripeSubscriptionId: STRIPE_SUB_ID, status: "past_due" });

      const userCount = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM users").get() as { c: number }
      ).c;
      expect(userCount).toBe(1);
    });
  });

  // ─── Scenario: subscription_cycle renewal ────────────────────────────────

  describe("when an invoice.payment_succeeded event with billing_reason 'subscription_cycle' is received", () => {
    let testDb: TestDb;
    let cmd: UpdateSubscriptionStatusCommand;

    beforeEach(() => {
      testDb = createTestDb();
      seedUserAndSubscription(testDb.sqlite);
      // Arrange: subscription is past_due so the renewal has something to fix
      testDb.sqlite.run(
        `UPDATE subscriptions SET status = 'past_due' WHERE stripe_subscription_id = '${STRIPE_SUB_ID}'`
      );
      cmd = new UpdateSubscriptionStatusCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the local Subscription status to 'active'", async () => {
      // AC 7.3
      const updated = await cmd.execute({ stripeSubscriptionId: STRIPE_SUB_ID, status: "active" });

      expect(updated.status).toBe("active");
    });
  });

  // ─── Scenario: stripe_subscription_id not found locally ──────────────────

  describe("when the stripe_subscription_id does not exist locally", () => {
    let testDb: TestDb;
    let cmd: UpdateSubscriptionStatusCommand;

    beforeEach(() => {
      testDb = createTestDb();
      // Deliberately no subscription seeded
      cmd = new UpdateSubscriptionStatusCommand(testDb.db, logger);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("throws a SubscriptionError rather than silently failing", async () => {
      // AC 7.5 — no silent failure per CLAUDE.md
      await expect(
        cmd.execute({ stripeSubscriptionId: "sub_nonexistent", status: "canceled" })
      ).rejects.toBeInstanceOf(SubscriptionError);
    });
  });
});
