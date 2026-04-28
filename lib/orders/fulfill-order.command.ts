import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import { authorizations, fulfillmentOrders, orders, users } from "@/lib/infra/db";
import type { Authorization, FulfillmentOrder, Order, User } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
/**
 * FulfillOrderCommand — the core order fulfillment transaction.
 *
 * Persists Order, User, Authorization, and FulfillmentOrder in a single DB
 * transaction. Handles both first-time fulfillment and re-fulfillment
 * (idempotent upsert per Story 5).
 *
 * Re-fulfillment logic (per SPEC + Story 5):
 *  1. Upsert User (email conflict key)
 *  2. Upsert Order (stripe_checkout_id conflict key)
 *  3. DELETE existing Authorizations for this order_id
 *  4. DELETE existing FulfillmentOrders for this order_id
 *  5. INSERT new Authorization
 *  6. INSERT new FulfillmentOrder (with downloads JSON)
 *
 * Note: FulfillOrderCommand handles its own user upsert inline so all 4 writes
 * share one transaction. It does NOT delegate to UpsertUserCommand (which opens
 * its own write and is used only for subscription flows).
 */
import { eq, sql } from "drizzle-orm";

export interface DownloadItem {
  name: string;
  file: string;
  size: string;
  location: string;
}

export interface FulfillOrderInput {
  stripeCheckoutId: string;
  customerEmail: string;
  customerName: string | null;
  stripeCustomerId: string | null;
  amountTotal: number;
  currency: string;
  offer: string;
  store: string;
  slug: string;
  downloads: DownloadItem[];
}

export interface FulfillOrderResult {
  order: Order;
  user: User;
  authorization: Authorization;
  fulfillmentOrder: FulfillmentOrder;
}

export class FulfillOrderCommand {
  readonly #db: AppDb;
  readonly #logger: Logger;

  constructor(db: AppDb, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Executes the full order fulfillment in one transaction.
   * Logs the order number before any DB writes (AC 3.7).
   */
  async execute(input: FulfillOrderInput): Promise<FulfillOrderResult> {
    // Order number derived from last 8 chars of the Stripe checkout id (per glossary)
    const orderNumber = `BIGZ-${input.stripeCheckoutId.slice(-8).toUpperCase()}`;

    // Log the order number BEFORE any writes — required by AC 3.7
    this.#logger.info("order.fulfill.start", {
      orderNumber,
      stripeCheckoutId: input.stripeCheckoutId,
    });

    try {
      const result = await this.#db.transaction(async (tx) => {
        const now = new Date().toISOString();

        // 1. Upsert User
        const user = await tx
          .insert(users)
          .values({
            email: input.customerEmail,
            name: input.customerName,
            stripeCustomerId: input.stripeCustomerId,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: users.email,
            set: {
              name: input.customerName,
              stripeCustomerId: input.stripeCustomerId,
            },
          })
          .returning()
          .get();

        // 2. Upsert Order
        const order = await tx
          .insert(orders)
          .values({
            stripeCheckoutId: input.stripeCheckoutId,
            number: orderNumber,
            userId: user.id,
            store: input.store,
            slug: input.slug,
            email: input.customerEmail,
            amountTotal: input.amountTotal,
            currency: input.currency,
            offer: input.offer,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: orders.stripeCheckoutId,
            set: {
              userId: user.id,
              store: input.store,
              slug: input.slug,
              email: input.customerEmail,
              amountTotal: input.amountTotal,
              currency: input.currency,
              offer: input.offer,
            },
          })
          .returning()
          .get();

        // 3. Delete existing Authorizations for re-fulfillment idempotency
        await tx.delete(authorizations).where(eq(authorizations.orderId, order.id));

        // 4. Delete existing FulfillmentOrders for re-fulfillment idempotency
        await tx.delete(fulfillmentOrders).where(eq(fulfillmentOrders.orderId, order.id));

        // 5. Insert new Authorization
        const authorization = await tx
          .insert(authorizations)
          .values({
            orderId: order.id,
            date: now,
            sku: input.slug,
            email: input.customerEmail,
            number: orderNumber,
          })
          .returning()
          .get();

        // 6. Insert new FulfillmentOrder with downloads as JSON (per ADR-002)
        const fulfillmentOrder = await tx
          .insert(fulfillmentOrders)
          .values({
            orderId: order.id,
            date: now,
            sku: input.slug,
            email: input.customerEmail,
            number: orderNumber,
            downloads: JSON.stringify(input.downloads),
          })
          .returning()
          .get();

        return { order, user, authorization, fulfillmentOrder };
      });

      this.#logger.info("order.fulfill.ok", { orderNumber, orderId: result.order.id });
      return result;
    } catch (err: unknown) {
      this.#logger.error("order.fulfill.failed", {
        orderNumber,
        reason: err instanceof Error ? err.message : String(err),
      });
      throw new FulfillmentError(`Order fulfillment failed for ${orderNumber}`, { cause: err });
    }
  }
}
