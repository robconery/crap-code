/**
 * Drizzle schema for the `orders` table.
 *
 * One Order = one Offer purchase. Order number format: BIGZ-{last-8-of-checkout-id}.
 * The stripe_checkout_id is the natural upsert key — re-fulfillment updates the
 * existing row rather than creating a duplicate (per Story 5 / SPEC idempotency rule).
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const orders = sqliteTable("orders", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),

  // Natural key — used as the upsert conflict target on re-fulfillment.
  stripeCheckoutId: text("stripe_checkout_id").notNull().unique(),

  // Human-readable order reference: BIGZ-{last 8 chars of stripeCheckoutId}
  number: text("number").notNull().unique(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id),

  store: text("store").notNull(),

  // Offer slug — links to the offer catalog (not stored locally, looked up at fulfillment time)
  slug: text("slug").notNull(),

  // Denormalized for fast lookup without joining users
  email: text("email").notNull(),

  // Nullable — course-only offers have no file
  file: text("file"),

  // e.g. "book", "course" — nullable for mixed offers
  resourceType: text("resource_type"),

  // Amount in smallest currency unit (cents for USD)
  amountTotal: integer("amount_total").notNull(),

  currency: text("currency").notNull(),

  // Offer display name
  offer: text("offer").notNull(),

  createdAt: text("created_at").notNull(),
});

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
