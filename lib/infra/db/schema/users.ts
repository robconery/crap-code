/**
 * Drizzle schema for the `users` table.
 *
 * A User is a customer identified by email. Email is the conflict key for
 * upserts — stripe_customer_id is supplemental identity (per glossary).
 * Both order fulfillment and subscription flows write to this table.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),

  // Conflict key for all upserts — email is the canonical User identity.
  email: text("email").notNull().unique(),

  // Nullable because subscription-only users may not supply a name.
  name: text("name"),

  // Stripe's customer identifier — supplemental, not the primary key.
  stripeCustomerId: text("stripe_customer_id"),

  createdAt: text("created_at").notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
