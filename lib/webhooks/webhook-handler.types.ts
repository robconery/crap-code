/**
 * WebhookHandler — the Strategy interface for all Stripe event handlers.
 *
 * Each Stripe event type that this system processes maps to exactly one class
 * implementing this interface. The WebhookRouter dispatches via a Map, so
 * adding a new event type = adding a new strategy class without touching the
 * router (Open/Closed Principle, GoF Strategy pattern — ADR-001).
 *
 * The `pingId` parameter is the DB primary key of the Ping record saved at
 * route entry — handlers use it to advance the Ping lifecycle
 * (received → fulfilled → closed, or → error on failure).
 */
import type { StripeWebhookEvent } from "@/lib/contracts/stripe-webhook.schema";

export interface WebhookHandler {
  /**
   * Processes the given Stripe event. Called by WebhookRouter after dispatch.
   *
   * @param event  - Fully parsed and validated Stripe event (from Zod schema)
   * @param pingId - DB id of the Ping row saved before this handler was called
   */
  handle(event: StripeWebhookEvent, pingId: number): Promise<void>;
}
