/**
 * OrderWebhookHandler — Strategy for checkout.session.completed events.
 *
 * Orchestrates the full order fulfillment pipeline:
 *   1. FulfillOrderCommand   — persists Order, User, Authorization, FulfillmentOrder
 *   2. UpdatePingStatus(fulfilled)
 *   3. SendFulfillmentEmailCommand — generates signed URLs, sends email
 *   4. UpdatePingStatus(closed)
 *
 * Error handling (per ADR-003 + Story 8):
 *   - Any thrown error → UpdatePingStatus(error) best-effort → Logger.error → rethrow
 *
 * Cognitive complexity is kept ≤ 10 per method by splitting concerns:
 *   handle()            → type guard + email guard + error boundary
 *   #runFulfillment()   → the happy-path pipeline (no branches)
 *   #onError()          → best-effort Ping status update + structured error log
 *
 * Constructor parameter limit (≤ 3) is satisfied by grouping commands into a
 * deps object — keeps injection explicit without exceeding the style limit.
 */
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";
import type { SendFulfillmentEmailCommand } from "@/lib/email/send-fulfillment-email.command";
import type { Logger } from "@/lib/infra/logger";
import type { FulfillOrderCommand } from "@/lib/orders/fulfill-order.command";
import type { UpdatePingStatusCommand } from "@/lib/ping/update-ping-status.command";
import type { WebhookHandler } from "@/lib/webhooks/webhook-handler.types";

/** Injected command dependencies — grouped to stay within the 3-parameter rule. */
export interface OrderWebhookHandlerDeps {
  fulfillOrder: FulfillOrderCommand;
  sendEmail: SendFulfillmentEmailCommand;
  updatePingStatus: UpdatePingStatusCommand;
}

export class OrderWebhookHandler implements WebhookHandler {
  readonly #deps: OrderWebhookHandlerDeps;
  readonly #logger: Logger;

  constructor(deps: OrderWebhookHandlerDeps, logger: Logger) {
    this.#deps = deps;
    this.#logger = logger;
  }

  /**
   * Entry point. Guards event type, validates customer email, then wraps the
   * pipeline in the error boundary that transitions Ping → error on failure.
   */
  async handle(event: StripeWebhookEvent, pingId: number): Promise<void> {
    if (event.type !== "checkout.session.completed") {
      this.#logger.warn("order-handler.wrong-event-type", { eventType: event.type });
      return;
    }

    const session = event.data.object;
    const customerEmail = session.customer_details?.email ?? session.customer_email ?? null;
    const customerName = session.customer_details?.name ?? null;

    if (!customerEmail) {
      this.#logger.error("order-handler.no-email", { stripeEventId: event.id, pingId });
      await this.#deps.updatePingStatus.execute({ pingId, status: "error" }).catch(() => {});
      throw new Error(`checkout.session.completed ${event.id} has no customer email`);
    }

    try {
      await this.#runFulfillment(event, pingId, customerEmail, customerName);
    } catch (err: unknown) {
      await this.#onError(err, pingId, event.id);
      throw err;
    }
  }

  /**
   * Happy-path pipeline: fulfill → ping:fulfilled → email → ping:closed.
   * No error handling here — caller wraps this in the try/catch boundary.
   */
  async #runFulfillment(
    event: StripeWebhookEvent & { type: "checkout.session.completed" },
    pingId: number,
    customerEmail: string,
    customerName: string | null | undefined
  ): Promise<void> {
    const session = event.data.object;

    const { order, user, fulfillmentOrder } = await this.#deps.fulfillOrder.execute({
      stripeCheckoutId: session.id,
      customerEmail,
      customerName: customerName ?? null,
      stripeCustomerId: session.customer,
      amountTotal: session.amount_total ?? 0,
      currency: session.currency ?? "usd",
      offer: session.metadata?.offer ?? "",
      store: session.metadata?.store ?? "",
      slug: session.metadata?.slug ?? "",
      // Downloads sourced from product metadata in production;
      // empty array handled gracefully by email command (AC 4.5).
      downloads: [],
    });

    await this.#deps.updatePingStatus.execute({ pingId, status: "fulfilled" });
    await this.#deps.sendEmail.execute({ user, fulfillmentOrder, offer: order.offer });
    await this.#deps.updatePingStatus.execute({ pingId, status: "closed" });
  }

  /**
   * Best-effort Ping → error transition. Logs the failure for Cloudflare log tail.
   * Swallows secondary errors from the status update itself.
   */
  async #onError(err: unknown, pingId: number, stripeEventId: string): Promise<void> {
    await this.#deps.updatePingStatus.execute({ pingId, status: "error" }).catch((updateErr) => {
      this.#logger.error("order-handler.ping-error-update-failed", {
        pingId,
        reason: updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
    });

    this.#logger.error("order-handler.failed", {
      pingId,
      stripeEventId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}
