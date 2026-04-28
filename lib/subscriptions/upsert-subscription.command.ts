/**
 * UpsertSubscriptionCommand — creates a Subscription record if none exists for
 * the given stripe_subscription_id.
 *
 * Uses INSERT … ON CONFLICT DO NOTHING so the operation is naturally idempotent:
 * a duplicate invoice.payment_succeeded (billing_reason=subscription_create) will
 * not create a second row (AC 6.3).
 *
 * Only stores the three access-authorization fields: stripe_subscription_id,
 * user_id, and status. No billing amounts, plan IDs, or invoice details are
 * persisted locally — the Stripe API remains the source of truth (AC 6.4).
 */
import { SubscriptionError } from "@/lib/errors/subscription.error";
import { subscriptions } from "@/lib/infra/db";
import type { Subscription } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
import { eq } from "drizzle-orm";

export interface UpsertSubscriptionInput {
  stripeSubscriptionId: string;
  userId: number;
  status: string;
}

export interface UpsertSubscriptionResult {
  subscription: Subscription;
  /** true when a new row was inserted; false when the row already existed. */
  created: boolean;
}

export class UpsertSubscriptionCommand {
  readonly #db: AppDb;
  readonly #logger: Logger;

  constructor(db: AppDb, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Inserts a Subscription row if one doesn't already exist for this
   * stripe_subscription_id. Returns the existing row untouched on conflict.
   *
   * Uses .returning() to detect whether the insert fired or was suppressed by
   * the conflict guard — an empty returning array means the row pre-existed.
   *
   * @throws {SubscriptionError} if the row cannot be retrieved after insert
   */
  async execute(input: UpsertSubscriptionInput): Promise<UpsertSubscriptionResult> {
    this.#logger.info("subscription.upsert.start", {
      stripeSubscriptionId: input.stripeSubscriptionId,
      userId: input.userId,
    });

    const now = new Date().toISOString();

    // ON CONFLICT DO NOTHING — idempotent; duplicate events create no second row.
    // .returning() gives us the new row if inserted, or an empty array on conflict.
    const inserted = await this.#db
      .insert(subscriptions)
      .values({
        stripeSubscriptionId: input.stripeSubscriptionId,
        userId: input.userId,
        status: input.status,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    const created = inserted.length > 0;

    // If inserted is non-empty the new row is already available; otherwise fetch the existing row.
    const row: Subscription | undefined = created
      ? inserted[0]
      : await this.#db.query.subscriptions.findFirst({
          where: eq(subscriptions.stripeSubscriptionId, input.stripeSubscriptionId),
        });

    if (!row) {
      // Should be unreachable — conflict guard would have found the existing row.
      throw new SubscriptionError(
        `Subscription row missing after upsert for ${input.stripeSubscriptionId}`
      );
    }

    this.#logger.info("subscription.upsert.ok", {
      stripeSubscriptionId: input.stripeSubscriptionId,
      subscriptionId: row.id,
      created,
    });

    return { subscription: row, created };
  }
}
