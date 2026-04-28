/**
 * Unit tests for WebhookRouter (Strategy dispatcher).
 * Verifies that each Stripe event type is routed to the correct handler
 * strategy, and that unknown event types are handled gracefully (ADR-001).
 *
 * Uses hand-written fake handlers to verify dispatch without real DB.
 */
import { describe, expect, it } from "bun:test";
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import { Logger } from "@/lib/infra/logger";
import type { WebhookHandler } from "@/lib/webhooks/webhook-handler.types";
import { WebhookRouter } from "@/lib/webhooks/webhook-router";

// ─── Fake Handler ─────────────────────────────────────────────────────────

/** Records all calls so tests can assert which handler was invoked. */
class FakeWebhookHandler implements WebhookHandler {
  readonly calls: Array<{ event: StripeWebhookEvent; pingId: number }> = [];

  async handle(event: StripeWebhookEvent, pingId: number): Promise<void> {
    this.calls.push({ event, pingId });
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

function makeCheckoutEvent(): StripeWebhookEvent {
  return {
    id: "evt_checkout_001",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_ABCD1234",
        object: "checkout.session",
        customer: "cus_001",
        customer_email: "rob@example.com",
        customer_details: { name: "Rob Conery", email: "rob@example.com" },
        amount_total: 3900,
        currency: "usd",
        metadata: { offer: "imposter-single", store: "bigmachine.io", slug: "imposter-single" },
      },
    },
  };
}

function makeInvoiceEvent(): StripeWebhookEvent {
  return {
    id: "evt_invoice_001",
    type: "invoice.payment_succeeded",
    data: {
      object: {
        id: "in_001",
        object: "invoice",
        customer: "cus_001",
        customer_email: "rob@example.com",
        customer_name: "Rob Conery",
        subscription: "sub_001",
        billing_reason: "subscription_create",
        status: "paid",
      },
    },
  };
}

function makeSubDeletedEvent(): StripeWebhookEvent {
  return {
    id: "evt_sub_deleted_001",
    type: "customer.subscription.deleted",
    data: {
      object: {
        id: "sub_001",
        object: "subscription",
        customer: "cus_001",
        status: "canceled",
      },
    },
  };
}

function makeSubUpdatedEvent(): StripeWebhookEvent {
  return {
    id: "evt_sub_updated_001",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_001",
        object: "subscription",
        customer: "cus_001",
        status: "past_due",
      },
    },
  };
}

function makeLogger() {
  return new Logger("test-correlation-id");
}

describe("WebhookRouter", () => {
  describe("when dispatching a 'checkout.session.completed' event", () => {
    it("routes to OrderWebhookHandler", async () => {
      const orderHandler = new FakeWebhookHandler();
      const router = new WebhookRouter(
        new Map([["checkout.session.completed", orderHandler]]),
        makeLogger()
      );
      const event = makeCheckoutEvent();
      await router.dispatch(event, 1);
      expect(orderHandler.calls).toHaveLength(1);
      expect(orderHandler.calls[0]?.event.type).toBe("checkout.session.completed");
    });
  });

  describe("when dispatching an 'invoice.payment_succeeded' event", () => {
    it("routes to SubscriptionPaymentHandler", async () => {
      const subHandler = new FakeWebhookHandler();
      const router = new WebhookRouter(
        new Map([["invoice.payment_succeeded", subHandler]]),
        makeLogger()
      );
      const event = makeInvoiceEvent();
      await router.dispatch(event, 2);
      expect(subHandler.calls).toHaveLength(1);
      expect(subHandler.calls[0]?.event.type).toBe("invoice.payment_succeeded");
    });
  });

  describe("when dispatching a 'customer.subscription.deleted' event", () => {
    it("routes to SubscriptionChangeHandler", async () => {
      const changeHandler = new FakeWebhookHandler();
      const router = new WebhookRouter(
        new Map([["customer.subscription.deleted", changeHandler]]),
        makeLogger()
      );
      const event = makeSubDeletedEvent();
      await router.dispatch(event, 3);
      expect(changeHandler.calls).toHaveLength(1);
      expect(changeHandler.calls[0]?.event.type).toBe("customer.subscription.deleted");
    });
  });

  describe("when dispatching a 'customer.subscription.updated' event", () => {
    it("routes to SubscriptionChangeHandler", async () => {
      const changeHandler = new FakeWebhookHandler();
      const router = new WebhookRouter(
        new Map([["customer.subscription.updated", changeHandler]]),
        makeLogger()
      );
      const event = makeSubUpdatedEvent();
      await router.dispatch(event, 4);
      expect(changeHandler.calls).toHaveLength(1);
      expect(changeHandler.calls[0]?.event.type).toBe("customer.subscription.updated");
    });
  });

  describe("when dispatching an unrecognised event type", () => {
    it(// ADR-001: unknown events must not throw — Stripe must always receive 200
    "logs a warning and returns without calling any handler", async () => {
      // Build an event with a type that has no registered handler
      const unknownEvent = {
        ...makeCheckoutEvent(),
        // Override type to something unregistered; cast needed since the union
        // doesn't include unknown types — we simulate raw unrecognised input
        type: "payment_intent.created",
      } as unknown as StripeWebhookEvent;

      const orderHandler = new FakeWebhookHandler();
      const router = new WebhookRouter(
        new Map([["checkout.session.completed", orderHandler]]),
        makeLogger()
      );

      // Must not throw
      await expect(router.dispatch(unknownEvent, 99)).resolves.toBeUndefined();
      // Handler for the known type must not have been called
      expect(orderHandler.calls).toHaveLength(0);
    });
  });
});
