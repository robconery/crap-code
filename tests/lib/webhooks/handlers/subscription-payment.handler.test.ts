/**
 * Integration tests for SubscriptionPaymentHandler.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations).
 * Covers Story 6 AC1–AC4 and Story 7 AC3 (subscription_cycle renewal).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import { Logger } from "@/lib/infra/logger";
import { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import { UpdateSubscriptionStatusCommand } from "@/lib/subscriptions/update-subscription-status.command";
import { UpsertSubscriptionCommand } from "@/lib/subscriptions/upsert-subscription.command";
import { UpsertUserCommand } from "@/lib/users/upsert-user.command";
import { SubscriptionPaymentHandler } from "@/lib/webhooks/handlers/subscription-payment.handler";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");

const CREATE_EVENT: StripeWebhookEvent = {
  id: "evt_test_invoice_001",
  type: "invoice.payment_succeeded",
  data: {
    object: {
      id: "in_test_001",
      object: "invoice",
      customer: "cus_test_001",
      customer_email: "subscriber@example.com",
      customer_name: "Jane Subscriber",
      subscription: "sub_test_001",
      billing_reason: "subscription_create",
      status: "paid",
    },
  },
};

const CYCLE_EVENT: StripeWebhookEvent = {
  id: "evt_test_invoice_cycle_001",
  type: "invoice.payment_succeeded",
  data: {
    object: {
      id: "in_test_cycle_001",
      object: "invoice",
      customer: "cus_test_001",
      customer_email: "subscriber@example.com",
      customer_name: "Jane Subscriber",
      subscription: "sub_test_001",
      billing_reason: "subscription_cycle",
      status: "paid",
    },
  },
};

function seedPing(sqlite: TestDb["sqlite"], eventId = "evt_test_invoice_001"): number {
  const now = "2024-01-15T10:00:00.000Z";
  sqlite.run(
    `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
     VALUES (?, 'invoice.payment_succeeded', '{}', 'received', ?, ?)`,
    [eventId, now, now]
  );
  return (sqlite.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

function makeHandler(db: TestDb["db"]): SubscriptionPaymentHandler {
  return new SubscriptionPaymentHandler(
    {
      upsertUser: new UpsertUserCommand(db, logger),
      upsertSubscription: new UpsertSubscriptionCommand(db, logger),
      updateSubscriptionStatus: new UpdateSubscriptionStatusCommand(db, logger),
      updatePingStatus: new UpdatePingStatusCommand(db, logger),
    },
    logger
  );
}

// ─── Scenario: first subscription payment (subscription_create) ──────────────

describe("SubscriptionPaymentHandler", () => {
  describe("when billing_reason is 'subscription_create'", () => {
    let testDb: TestDb;
    let pingId: number;

    beforeEach(async () => {
      testDb = createTestDb();
      pingId = seedPing(testDb.sqlite);
      await makeHandler(testDb.db).handle(CREATE_EVENT, pingId);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("creates a User record with email and stripe_customer_id", async () => {
      // AC 6.1
      const user = testDb.sqlite
        .query("SELECT * FROM users WHERE email = 'subscriber@example.com'")
        .get() as { email: string; stripe_customer_id: string };

      expect(user).toBeDefined();
      expect(user.email).toBe("subscriber@example.com");
      expect(user.stripe_customer_id).toBe("cus_test_001");
    });

    it("creates a Subscription record linked to the User", async () => {
      // AC 6.2
      const sub = testDb.sqlite
        .query("SELECT * FROM subscriptions WHERE stripe_subscription_id = 'sub_test_001'")
        .get() as { user_id: number; status: string };

      expect(sub).toBeDefined();
      expect(sub.user_id).toBe(1);
    });

    it("stores only stripe_subscription_id, status, and user_id — no billing details", async () => {
      // AC 6.4
      const sub = testDb.sqlite
        .query("SELECT * FROM subscriptions WHERE stripe_subscription_id = 'sub_test_001'")
        .get() as Record<string, unknown>;

      expect(Object.keys(sub)).not.toContain("amount_due");
      expect(Object.keys(sub)).not.toContain("plan_id");
    });

    it("transitions Ping status to 'closed'", async () => {
      const ping = testDb.sqlite.query("SELECT status FROM pings WHERE id = ?").get(pingId) as {
        status: string;
      };
      expect(ping.status).toBe("closed");
    });
  });

  // ─── Scenario: duplicate subscription_create (idempotent) ────────────────

  describe("when billing_reason is 'subscription_create' and the subscription already exists", () => {
    let testDb: TestDb;

    beforeEach(async () => {
      testDb = createTestDb();
      const handler = makeHandler(testDb.db);
      // First payment
      const pingId1 = seedPing(testDb.sqlite, "evt_test_invoice_001");
      await handler.handle(CREATE_EVENT, pingId1);
      // Duplicate
      const pingId2 = seedPing(testDb.sqlite, "evt_test_invoice_002");
      await handler.handle({ ...CREATE_EVENT, id: "evt_test_invoice_002" }, pingId2);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("does not create a duplicate Subscription row", async () => {
      // AC 6.3
      const count = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM subscriptions").get() as { c: number }
      ).c;
      expect(count).toBe(1);
    });

    it("does not create a duplicate User row", async () => {
      const count = (testDb.sqlite.query("SELECT COUNT(*) as c FROM users").get() as { c: number })
        .c;
      expect(count).toBe(1);
    });
  });

  // ─── Scenario: subscription_cycle renewal ────────────────────────────────

  describe("when billing_reason is 'subscription_cycle' (renewal)", () => {
    let testDb: TestDb;
    let pingId: number;

    beforeEach(async () => {
      testDb = createTestDb();
      // Arrange: user + past_due subscription already exists
      testDb.sqlite.run(
        "INSERT INTO users (email, name, stripe_customer_id, created_at) VALUES ('subscriber@example.com', 'Jane', 'cus_test_001', '2024-01-01T00:00:00.000Z')"
      );
      testDb.sqlite.run(
        "INSERT INTO subscriptions (stripe_subscription_id, user_id, status, created_at, updated_at) VALUES ('sub_test_001', 1, 'past_due', '2024-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z')"
      );
      pingId = seedPing(testDb.sqlite, "evt_test_invoice_cycle_001");
      await makeHandler(testDb.db).handle(CYCLE_EVENT, pingId);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates the Subscription status to 'active'", async () => {
      // AC 7.3
      const sub = testDb.sqlite
        .query("SELECT status FROM subscriptions WHERE stripe_subscription_id = 'sub_test_001'")
        .get() as { status: string };

      expect(sub.status).toBe("active");
    });

    it("does not create a duplicate Subscription row", async () => {
      const count = (
        testDb.sqlite.query("SELECT COUNT(*) as c FROM subscriptions").get() as { c: number }
      ).c;
      expect(count).toBe(1);
    });
  });
});
