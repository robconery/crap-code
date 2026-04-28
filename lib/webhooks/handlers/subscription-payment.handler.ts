/**
 * SubscriptionPaymentHandler — Strategy for invoice.payment_succeeded events.
 *
 * Routes on billing_reason:
 *   - subscription_create → UpsertUserCommand + UpsertSubscriptionCommand
 *   - subscription_cycle  → UpdateSubscriptionStatusCommand(active)
 *   - other               → warn + return (no-op)
 *
 * Ping lifecycle (Story 2 AC2/AC3):
 *   success → ping:fulfilled → ping:closed
 *   failure → ping:error → rethrow
 *
 * Constructor parameter limit (≤ 3) is satisfied by grouping commands into
 * a deps object.
 */
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import type { Logger } from "@/lib/infra/logger";
import type { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import type { UpdateSubscriptionStatusCommand } from "@/lib/subscriptions/update-subscription-status.command";
import type { UpsertSubscriptionCommand } from "@/lib/subscriptions/upsert-subscription.command";
import type { UpsertUserCommand } from "@/lib/users/upsert-user.command";
import type { WebhookHandler } from "@/lib/webhooks/webhook-handler.types";

/** Injected command dependencies. */
export interface SubscriptionPaymentHandlerDeps {
  upsertUser: UpsertUserCommand;
  upsertSubscription: UpsertSubscriptionCommand;
  updateSubscriptionStatus: UpdateSubscriptionStatusCommand;
  updatePingStatus: UpdatePingStatusCommand;
}

export class SubscriptionPaymentHandler implements WebhookHandler {
  readonly #deps: SubscriptionPaymentHandlerDeps;
  readonly #logger: Logger;

  constructor(deps: SubscriptionPaymentHandlerDeps, logger: Logger) {
    this.#deps = deps;
    this.#logger = logger;
  }

  /**
   * Processes an invoice.payment_succeeded event.
   * Routes to subscription creation or renewal based on billing_reason.
   */
  async handle(event: StripeWebhookEvent, pingId: number): Promise<void> {
    if (event.type !== "invoice.payment_succeeded") {
      this.#logger.warn("sub-payment-handler.wrong-event-type", { eventType: event.type });
      return;
    }

    const invoice = event.data.object;

    try {
      await this.#routeByBillingReason(invoice, pingId);
      await this.#deps.updatePingStatus.execute({ pingId, status: "fulfilled" });
      await this.#deps.updatePingStatus.execute({ pingId, status: "closed" });
    } catch (err: unknown) {
      await this.#onError(err, pingId, event.id);
      throw err;
    }
  }

  /**
   * Delegates to the correct sub-flow based on billing_reason.
   * subscription_create → create user + subscription.
   * subscription_cycle  → renew (update status to active).
   * Other reasons       → warn and no-op (Stripe may send others we don't handle).
   */
  async #routeByBillingReason(
    invoice: {
      billing_reason: string;
      customer: string;
      customer_email: string | null;
      customer_name?: string | null | undefined;
      subscription: string | null;
      status: string | null;
    },
    pingId: number
  ): Promise<void> {
    if (invoice.billing_reason === "subscription_create") {
      await this.#handleCreate(invoice);
    } else if (invoice.billing_reason === "subscription_cycle") {
      await this.#handleCycle(invoice);
    } else {
      // Manual invoices and other billing reasons are not handled here
      this.#logger.warn("sub-payment-handler.unhandled-billing-reason", {
        billingReason: invoice.billing_reason,
        pingId,
      });
    }
  }

  /** First payment: upsert the user and create the subscription record. */
  async #handleCreate(invoice: {
    customer: string;
    customer_email: string | null;
    customer_name?: string | null | undefined;
    subscription: string | null;
    status: string | null;
  }): Promise<void> {
    const email = invoice.customer_email;
    if (!email) {
      throw new Error("invoice.payment_succeeded has no customer_email");
    }

    // exactOptionalPropertyTypes: conditionally include name only when present
    const user = await this.#deps.upsertUser.execute({
      email,
      ...(invoice.customer_name ? { name: invoice.customer_name } : {}),
      stripeCustomerId: invoice.customer,
    });

    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) {
      throw new Error("invoice.payment_succeeded has no subscription id");
    }

    await this.#deps.upsertSubscription.execute({
      stripeSubscriptionId,
      userId: user.id,
      status: invoice.status ?? "active",
    });
  }

  /** Renewal: update the existing subscription status back to active. */
  async #handleCycle(invoice: {
    subscription: string | null;
  }): Promise<void> {
    const stripeSubscriptionId = invoice.subscription;
    if (!stripeSubscriptionId) {
      throw new Error("invoice.payment_succeeded (cycle) has no subscription id");
    }
    await this.#deps.updateSubscriptionStatus.execute({
      stripeSubscriptionId,
      status: "active",
    });
  }

  /** Best-effort Ping → error + structured log before rethrow. */
  async #onError(err: unknown, pingId: number, stripeEventId: string): Promise<void> {
    await this.#deps.updatePingStatus.execute({ pingId, status: "error" }).catch((updateErr) => {
      this.#logger.error("sub-payment-handler.ping-error-update-failed", {
        pingId,
        reason: updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
    });

    this.#logger.error("sub-payment-handler.failed", {
      pingId,
      stripeEventId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
