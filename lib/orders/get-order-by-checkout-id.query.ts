import { orders } from "@/lib/infra/db";
import type { Order } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
/**
 * GetOrderByCheckoutIdQuery — returns an Order by Stripe checkout session id, or null.
 *
 * Read-only. Used by handlers to check for existing orders before FulfillOrderCommand.
 */
import { eq } from "drizzle-orm";

export interface GetOrderByCheckoutIdInput {
  stripeCheckoutId: string;
}

export class GetOrderByCheckoutIdQuery {
  readonly #db: AppDb;

  constructor(db: AppDb) {
    this.#db = db;
  }

  /** Returns the Order for the given Stripe checkout id, or null if none exists. */
  async run(input: GetOrderByCheckoutIdInput): Promise<Order | null> {
    const result = await this.#db
      .select()
      .from(orders)
      .where(eq(orders.stripeCheckoutId, input.stripeCheckoutId))
      .get();

    return result ?? null;
  }
}
