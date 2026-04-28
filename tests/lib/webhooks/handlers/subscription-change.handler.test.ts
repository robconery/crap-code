/**
 * Integration tests for SubscriptionChangeHandler.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 7 AC1–AC5 — cancellation, status update, User preservation,
 * and the unknown-subscription error path.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import { SubscriptionError } from "@/lib/errors/subscription.error";
import { Logger } from "@/lib/infra/logger";
import { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import { UpdateSubscriptionStatusCommand } from "@/lib/subscriptions/update-subscription-status.command";
import { SubscriptionChangeHandler } from "@/lib/webhooks/handlers/subscription-change.handler";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");

const DELETED_EVENT: StripeWebhookEvent = {
  id: "evt_test_sub_cancel_001",
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: "sub_test_001",
      object: "subscription",
      customer: "cus_test_001",
      status: "canceled",
    },
  },
};

const UPDATED_EVENT: StripeWebhookEvent = {
  id: "evt_test_sub_update_001",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_test_001",
      object: "subscription",
      customer: "cus_test_001",
      status: "past_due",
    },
  },
};

/** Seeds a user + active subscription for the standard happy-path scenarios. */
function seedUserAndSubscription(sqlite: TestDb["sqlite"]): void {
  sqlite.run(
    "INSERT INTO users (email, name, stripe_customer_id, created_at) VALUES ('subscriber@example.com', 'Jane Subscriber', 'cus_test_001', '2024-01-15T10:00:00.000Z')"
  );
  sqlite.run(
    "INSERT INTO subscriptions (stripe_subscription_id, user_id, status, created_at, updated_at) VALUES ('sub_test_001', 1, 'active', '2024-01-15T10:00:00.000Z', '2024-01-15T10:00:00.000Z')"
  );
}

function seedPing(sqlite: TestDb["sqlite"], eventId: string): number {
  const now = "2024-01-15T10:00:00.000Z";
  sqlite.run(
    `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
     VALUES (?, 'customer.subscription.deleted', '{}', 'received', ?, ?)`,
    [eventId, now, now]
  );
  return (sqlite.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

function makeHandler(db: TestDb["db"]): SubscriptionChangeHandler {
  return new SubscriptionChangeHandler(
    {
      updateSubscriptionStatus: new UpdateSubscriptionStatusCommand(db, logger),
      updatePingStatus: new UpdatePingStatusCommand(db, logger),
    },
    logger
  );
}

// ─── Scenario: customer.subscription.deleted ─────────────────────────────────

describe("SubscriptionChangeHandler", () => {
  describe("when handling a 'customer.subscription.deleted' event", () => {
    let testDb: TestDb;
    let pingId: number;

    beforeEach(async () => {
      testDb = createTestDb();
      seedUserAndSubscription(testDb.sqlite);
      pingId = seedPing(testDb.sqlite, "evt_test_sub_cancel_001");
      await makeHandler(testDb.db).handle(DELETED_EVENT, pingId);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the local Subscription status to 'canceled'", async () => {
      // AC 7.1
      const sub = testDb.sqlite
        .query("SELECT status FROM subscriptions WHERE stripe_subscription_id = 'sub_test_001'")
        .get() as { status: string };

      expect(sub.status).toBe("canceled");
    });

    it("does not delete or duplicate the associated User record", async () => {
      // AC 7.4
      const userCount = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM users").get() as { c: number }
      ).c;
      expect(userCount).toBe(1);
    });

    it("transitions Ping status to 'closed'", async () => {
      const ping = testDb.sqlite.query("SELECT status FROM pings WHERE id = ?").get(pingId) as {
        status: string;
      };
      expect(ping.status).toBe("closed");
    });
  });

  // ─── Scenario: customer.subscription.updated ─────────────────────────────

  describe("when handling a 'customer.subscription.updated' event", () => {
    let testDb: TestDb;
    let pingId: number;

    beforeEach(async () => {
      testDb = createTestDb();
      seedUserAndSubscription(testDb.sqlite);
      pingId = seedPing(testDb.sqlite, "evt_test_sub_update_001");
      await makeHandler(testDb.db).handle(UPDATED_EVENT, pingId);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the local Subscription status to match the new Stripe status", async () => {
      // AC 7.2
      const sub = testDb.sqlite
        .query("SELECT status FROM subscriptions WHERE stripe_subscription_id = 'sub_test_001'")
        .get() as { status: string };

      expect(sub.status).toBe("past_due");
    });

    it("does not delete or duplicate the associated User record", async () => {
      // AC 7.4
      const userCount = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM users").get() as { c: number }
      ).c;
      expect(userCount).toBe(1);
    });
  });

  // ─── Scenario: unknown subscription id ───────────────────────────────────

  describe("when the stripe_subscription_id does not exist locally", () => {
    let testDb: TestDb;
    let pingId: number;

    beforeEach(() => {
      testDb = createTestDb();
      // Deliberately no subscription seeded
      pingId = seedPing(testDb.sqlite, "evt_test_sub_unknown_001");
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("throws a SubscriptionError (no silent failure)", async () => {
      // AC 7.5
      const unknownEvent: StripeWebhookEvent = {
        id: "evt_test_sub_unknown_001",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_UNKNOWN",
            object: "subscription",
            customer: "cus_test_001",
            status: "canceled",
          },
        },
      };

      await expect(makeHandler(testDb.db).handle(unknownEvent, pingId)).rejects.toBeInstanceOf(
        SubscriptionError
      );
    });

    it("transitions Ping status to 'error'", async () => {
      // AC 8.2 — error state is set before rethrowing
      const unknownEvent: StripeWebhookEvent = {
        id: "evt_test_sub_unknown_001",
        type: "customer.subscription.deleted",
        data: {
          object: {
            id: "sub_UNKNOWN",
            object: "subscription",
            customer: "cus_test_001",
            status: "canceled",
          },
        },
      };

      await expect(makeHandler(testDb.db).handle(unknownEvent, pingId)).rejects.toThrow();

      const ping = testDb.sqlite.query("SELECT status FROM pings WHERE id = ?").get(pingId) as {
        status: string;
      };
      expect(ping.status).toBe("error");
    });
  });
});
