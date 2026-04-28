/**
 * UpdateSubscriptionStatusCommand — transitions the local Subscription.status
 * to match a Stripe lifecycle event.
 *
 * Used for:
 *  - customer.subscription.deleted  → status = 'canceled'  (AC 7.1)
 *  - customer.subscription.updated  → status = new Stripe status (AC 7.2)
 *  - invoice.payment_succeeded (cycle) → status = 'active' (AC 7.3)
 *
 * Throws SubscriptionError if no local row is found — per AC 7.5 this must NOT
 * be silently swallowed; the calling handler logs it and returns a non-2xx.
 *
 * The User record is never touched here — AC 7.4 compliance.
 */
import { SubscriptionError } from "@/lib/errors/subscription.error";
import { subscriptions } from "@/lib/infra/db";
import type { Subscription } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
import { eq } from "drizzle-orm";

export interface UpdateSubscriptionStatusInput {
  stripeSubscriptionId: string;
  status: string;
}

export class UpdateSubscriptionStatusCommand {
  readonly #db: AppDb;
  readonly #logger: Logger;

  constructor(db: AppDb, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Looks up the Subscription by stripe_subscription_id, updates status + updated_at.
   *
   * @throws {SubscriptionError} when no matching Subscription exists (AC 7.5)
   */
  async execute(input: UpdateSubscriptionStatusInput): Promise<Subscription> {
    this.#logger.info("subscription.status-update.start", {
      stripeSubscriptionId: input.stripeSubscriptionId,
      newStatus: input.status,
    });

    // Verify the subscription exists before attempting the update.
    // Throw immediately rather than silently no-oping on an unknown id (AC 7.5).
    const existing = await this.#db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, input.stripeSubscriptionId),
    });

    if (!existing) {
      throw new SubscriptionError(
        `Subscription not found for stripe_subscription_id: ${input.stripeSubscriptionId}`
      );
    }

    const now = new Date().toISOString();

    const updated = await this.#db
      .update(subscriptions)
      .set({ status: input.status, updatedAt: now })
      .where(eq(subscriptions.stripeSubscriptionId, input.stripeSubscriptionId))
      .returning()
      .get();

    this.#logger.info("subscription.status-update.ok", {
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscriptionId: updated.id,
      newStatus: updated.status,
    });

    return updated;
  }
}
