/**
 * Drizzle schema for the `subscriptions` table.
 *
 * Only the minimal fields required for access authorization are stored locally.
 * The Stripe API remains the source of truth for billing state, plan details,
 * and invoice history — we deliberately do not replicate those here.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "./users";

export const subscriptions = sqliteTable("subscriptions", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),

  // Natural key — upsert conflict target.
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),

  userId: integer("user_id")
    .notNull()
    .references(() => users.id),

  // Mirrors Stripe subscription status: active | canceled | past_due | etc.
  // We store this so access-authorization queries don't need to hit the Stripe API.
  status: text("status").notNull(),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
