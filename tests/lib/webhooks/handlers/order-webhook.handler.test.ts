/**
 * Integration tests for OrderWebhookHandler.
 * Uses real in-memory SQLite via createTestDb (Drizzle migrations) + fake adapters.
 * Covers Story 2 AC2/AC3, Story 4 AC4, Story 8 AC1/AC2.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import { SendFulfillmentEmailCommand } from "@/lib/email/send-fulfillment-email.command";
import type { AppDb } from "@/lib/infra/db/client";
import { Logger } from "@/lib/infra/logger";
import { FulfillOrderCommand } from "@/lib/orders/fulfill-order.command";
import { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import { OrderWebhookHandler } from "@/lib/webhooks/handlers/order-webhook.handler";
import { FakeEmailSender } from "@/tests/fakes/fake-email-sender";
import { FakeFileStorage } from "@/tests/fakes/fake-file-storage";
import { type TestDb, createTestDb } from "@/tests/helpers/create-test-db";

const logger = new Logger("test-correlation-id");

const CHECKOUT_EVENT: StripeWebhookEvent = {
  id: "evt_test_001",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_ABCD1234",
      object: "checkout.session",
      customer: "cus_test_001",
      customer_email: "rob@example.com",
      customer_details: { name: "Rob Conery", email: "rob@example.com" },
      amount_total: 3900,
      currency: "usd",
      metadata: { offer: "imposter-single", store: "bigmachine.io", slug: "imposter-single" },
    },
  },
};

/** Inserts a ping row and returns its id. */
function seedPing(sqlite: TestDb["sqlite"], status = "received"): number {
  const now = "2024-01-15T10:00:00.000Z";
  sqlite.run(
    `INSERT INTO pings (stripe_event_id, event_type, raw_payload, status, created_at, updated_at)
     VALUES ('evt_test_001', 'checkout.session.completed', '{}', ?, ?, ?)`,
    [status, now, now]
  );
  return (sqlite.query("SELECT last_insert_rowid() as id").get() as { id: number }).id;
}

/** Wires the handler with real commands and fake external adapters. */
function makeHandler(db: AppDb): {
  handler: OrderWebhookHandler;
  emailSender: FakeEmailSender;
  fileStorage: FakeFileStorage;
} {
  const fileStorage = new FakeFileStorage();
  const emailSender = new FakeEmailSender();
  const handler = new OrderWebhookHandler(
    {
      fulfillOrder: new FulfillOrderCommand(db, logger),
      sendEmail: new SendFulfillmentEmailCommand(fileStorage, emailSender, logger),
      updatePingStatus: new UpdatePingStatusCommand(db, logger),
    },
    logger
  );
  return { handler, emailSender, fileStorage };
}

// ─── Scenario: full order fulfillment flow succeeds ──────────────────────────

describe("OrderWebhookHandler", () => {
  describe("when the full order fulfillment flow succeeds", () => {
    let testDb: TestDb;
    let pingId: number;
    let emailSender: FakeEmailSender;

    beforeEach(async () => {
      testDb = createTestDb();
      pingId = seedPing(testDb.sqlite);
      const { handler, emailSender: es } = makeHandler(testDb.db);
      emailSender = es;
      await handler.handle(CHECKOUT_EVENT, pingId);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("transitions Ping status to 'closed' after the full pipeline completes", async () => {
      // AC 2.2 — ping passes through fulfilled → closed
      const ping = testDb.sqlite.query("SELECT status FROM pings WHERE id = ?").get(pingId) as {
        status: string;
      };
      expect(ping.status).toBe("closed");
    });

    it("dispatches the fulfillment email", async () => {
      // AC 4.4
      expect(emailSender.sentEmails).toHaveLength(1);
    });

    it("sends the email to the customer's address", async () => {
      const email = emailSender.sentEmails[0];
      expect(email?.to).toBe("rob@example.com");
    });
  });

  // ─── Scenario: FulfillOrderCommand throws ────────────────────────────────

  describe("when FulfillOrderCommand throws", () => {
    let testDb: TestDb;
    let pingId: number;

    beforeEach(() => {
      testDb = createTestDb();
      pingId = seedPing(testDb.sqlite);
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates Ping status to 'error'", async () => {
      // AC 8.2
      const throwingFulfill = {
        execute: async () => {
          throw new Error("DB connection lost");
        },
      } as unknown as FulfillOrderCommand;

      const handler = new OrderWebhookHandler(
        {
          fulfillOrder: throwingFulfill,
          sendEmail: new SendFulfillmentEmailCommand(
            new FakeFileStorage(),
            new FakeEmailSender(),
            logger
          ),
          updatePingStatus: new UpdatePingStatusCommand(testDb.db, logger),
        },
        logger
      );

      await expect(handler.handle(CHECKOUT_EVENT, pingId)).rejects.toThrow("DB connection lost");

      const ping = testDb.sqlite.query("SELECT status FROM pings WHERE id = ?").get(pingId) as {
        status: string;
      };
      expect(ping.status).toBe("error");
    });

    it("re-throws the original error", async () => {
      // AC 8.1
      const throwingFulfill = {
        execute: async () => {
          throw new Error("DB connection lost");
        },
      } as unknown as FulfillOrderCommand;

      const handler = new OrderWebhookHandler(
        {
          fulfillOrder: throwingFulfill,
          sendEmail: new SendFulfillmentEmailCommand(
            new FakeFileStorage(),
            new FakeEmailSender(),
            logger
          ),
          updatePingStatus: new UpdatePingStatusCommand(testDb.db, logger),
        },
        logger
      );

      await expect(handler.handle(CHECKOUT_EVENT, pingId)).rejects.toThrow("DB connection lost");
    });
  });

  // ─── Scenario: SendFulfillmentEmailCommand throws ────────────────────────

  describe("when SendFulfillmentEmailCommand throws", () => {
    let testDb: TestDb;
    let pingId: number;
    let emailSender: FakeEmailSender;

    beforeEach(() => {
      testDb = createTestDb();
      pingId = seedPing(testDb.sqlite);
      emailSender = new FakeEmailSender();
      emailSender.failNextWith(new Error("Resend 500"));
    });

    afterEach(() => {
      testDb.sqlite.close();
    });

    it("updates Ping status to 'error'", async () => {
      // AC 8.2
      const { handler } = makeHandler(testDb.db);
      // Re-wire with the pre-configured failing emailSender
      const failingHandler = new OrderWebhookHandler(
        {
          fulfillOrder: new FulfillOrderCommand(testDb.db, logger),
          sendEmail: new SendFulfillmentEmailCommand(new FakeFileStorage(), emailSender, logger),
          updatePingStatus: new UpdatePingStatusCommand(testDb.db, logger),
        },
        logger
      );
      void handler; // unused — using failingHandler

      await expect(failingHandler.handle(CHECKOUT_EVENT, pingId)).rejects.toThrow();

      const ping = testDb.sqlite.query("SELECT status FROM pings WHERE id = ?").get(pingId) as {
        status: string;
      };
      expect(ping.status).toBe("error");
    });
  });
});
