/**
 * Drizzle schema for the `authorizations` table.
 *
 * An Authorization grants a User access to course content purchased via an Order.
 * These records are delete-and-rebuild on re-fulfillment — no upsert pattern here
 * because the set of authorizations may change between fulfillment runs.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { orders } from "./orders";

export const authorizations = sqliteTable("authorizations", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),

  // Delete all authorizations for this order_id before rebuilding on re-fulfillment.
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),

  date: text("date").notNull(),
  sku: text("sku").notNull(),
  email: text("email").notNull(),

  // Denormalized order number for fast access without joining orders
  number: text("number").notNull(),
});

export type Authorization = typeof authorizations.$inferSelect;
export type NewAuthorization = typeof authorizations.$inferInsert;
