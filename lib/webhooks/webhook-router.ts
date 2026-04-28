/**
 * WebhookRouter — the Strategy dispatcher.
 *
 * Accepts a Map of event type → WebhookHandler at construction time.
 * dispatch() looks up the handler and calls handle(); if no handler is
 * registered for the event type, logs a warn and returns without error.
 *
 * Why Map, not switch: the map is injected at the composition root, so the
 * router itself never needs to change when new event types are added
 * (ADR-001 — Strategy pattern, GoF). Unknown event types are deliberately
 * handled silently: Stripe must always receive a 200 response to avoid
 * flooding retries for events we don't care about.
 */
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import type { Logger } from "@/lib/infra/logger";
import type { WebhookHandler } from "./webhook-handler.types";

export class WebhookRouter {
  readonly #handlers: Map<string, WebhookHandler>;
  readonly #logger: Logger;

  /**
   * @param handlers - Map of Stripe event type → handler strategy.
   *   Built and injected from the composition root — the router is unaware of
   *   concrete handler classes.
   * @param logger   - Logger instance with correlation ID for this request.
   */
  constructor(handlers: Map<string, WebhookHandler>, logger: Logger) {
    this.#handlers = handlers;
    this.#logger = logger;
  }

  /**
   * Routes the event to its registered handler, or no-ops with a warning
   * if the event type is not in the handler map.
   *
   * @param event  - Validated Stripe webhook event.
   * @param pingId - DB id of the Ping record created before this call.
   */
  async dispatch(event: StripeWebhookEvent, pingId: number): Promise<void> {
    const handler = this.#handlers.get(event.type);

    if (!handler) {
      // Unknown events are not errors — Stripe sends many event types we don't
      // handle. Log a warning so it's discoverable without causing retries.
      this.#logger.warn("webhook.router.unhandled", { eventType: event.type, pingId });
      return;
    }

    this.#logger.info("webhook.router.dispatch", { eventType: event.type, pingId });
    await handler.handle(event, pingId);
  }
}
