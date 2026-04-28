/**
 * SubscriptionChangeHandler — Strategy for subscription lifecycle events.
 *
 * Handles:
 *   customer.subscription.deleted → UpdateSubscriptionStatusCommand(canceled)
 *   customer.subscription.updated → UpdateSubscriptionStatusCommand(newStatus)
 *
 * SubscriptionError (AC 7.5): if UpdateSubscriptionStatusCommand throws because
 * no local row exists, the error is caught here, logged, and rethrown so the
 * route layer returns a non-2xx response. This is intentional — a subscription
 * event for an unknown sub is an unexpected state that should be investigated.
 *
 * Ping lifecycle (Story 2 AC2/AC3):
 *   success → ping:fulfilled → ping:closed
 *   failure → ping:error → rethrow
 *
 * Constructor parameter limit (≤ 3) satisfied via deps object.
 */
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import type { Logger } from "@/lib/infra/logger";
import type { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import type { UpdateSubscriptionStatusCommand } from "@/lib/subscriptions/update-subscription-status.command";
import type { WebhookHandler } from "@/lib/webhooks/webhook-handler.types";

/** Injected command dependencies. */
export interface SubscriptionChangeHandlerDeps {
  updateSubscriptionStatus: UpdateSubscriptionStatusCommand;
  updatePingStatus: UpdatePingStatusCommand;
}

export class SubscriptionChangeHandler implements WebhookHandler {
  readonly #deps: SubscriptionChangeHandlerDeps;
  readonly #logger: Logger;

  constructor(deps: SubscriptionChangeHandlerDeps, logger: Logger) {
    this.#deps = deps;
    this.#logger = logger;
  }

  /**
   * Routes customer.subscription.deleted and customer.subscription.updated to
   * UpdateSubscriptionStatusCommand with the appropriate target status.
   *
   * Throws SubscriptionError (from the command) if the subscription is unknown
   * locally — the route layer must return non-2xx in that case (AC 7.5).
   */
  async handle(event: StripeWebhookEvent, pingId: number): Promise<void> {
    if (
      event.type !== "customer.subscription.deleted" &&
      event.type !== "customer.subscription.updated"
    ) {
      this.#logger.warn("sub-change-handler.wrong-event-type", { eventType: event.type });
      return;
    }

    const subscription = event.data.object;

    try {
      await this.#deps.updateSubscriptionStatus.execute({
        stripeSubscriptionId: subscription.id,
        // For deleted events Stripe already sets status = 'canceled'; use the payload
        // value directly so we stay in sync with whatever Stripe reports.
        status: subscription.status,
      });

      await this.#deps.updatePingStatus.execute({ pingId, status: "fulfilled" });
      await this.#deps.updatePingStatus.execute({ pingId, status: "closed" });
    } catch (err: unknown) {
      await this.#onError(err, pingId, event.id);
      throw err;
    }
  }

  /** Best-effort Ping → error + structured log before rethrow. */
  async #onError(err: unknown, pingId: number, stripeEventId: string): Promise<void> {
    await this.#deps.updatePingStatus.execute({ pingId, status: "error" }).catch((updateErr) => {
      this.#logger.error("sub-change-handler.ping-error-update-failed", {
        pingId,
        reason: updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
    });

    this.#logger.error("sub-change-handler.failed", {
      pingId,
      stripeEventId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
