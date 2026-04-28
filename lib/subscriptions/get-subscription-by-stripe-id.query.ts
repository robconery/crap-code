/**
 * GetSubscriptionByStripeIdQuery — read-only lookup by stripe_subscription_id.
 *
 * Separated from commands so reads can never accidentally mutate state (CQRS
 * naming convention followed throughout this codebase).
 *
 * Returns null when no subscription is found — the caller decides whether that
 * is an error condition (e.g. UpdateSubscriptionStatusCommand checks explicitly).
 */
import { subscriptions } from "@/lib/infra/db";
import type { Subscription } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import { eq } from "drizzle-orm";

export interface GetSubscriptionByStripeIdInput {
  stripeSubscriptionId: string;
}

export class GetSubscriptionByStripeIdQuery {
  readonly #db: AppDb;

  constructor(db: AppDb) {
    this.#db = db;
  }

  /** Returns the Subscription, or null if none found. */
  async run(input: GetSubscriptionByStripeIdInput): Promise<Subscription | null> {
    const row = await this.#db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, input.stripeSubscriptionId),
    });

    return row ?? null;
  }
}
