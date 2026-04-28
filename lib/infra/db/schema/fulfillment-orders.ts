/**
 * Drizzle schema for the `fulfillment_orders` table.
 *
 * A FulfillmentOrder tracks delivery of downloadable items for an Order.
 * Like authorizations, these are delete-and-rebuild on re-fulfillment.
 *
 * The `downloads` column stores a JSON array per ADR-002: downloads are always
 * read/written as a unit with the parent record, and no query needs to filter
 * on individual download rows.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { orders } from "./orders";

export const fulfillmentOrders = sqliteTable("fulfillment_orders", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),

  // Delete all fulfillment_orders for this order_id before rebuilding on re-fulfillment.
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),

  date: text("date").notNull(),
  sku: text("sku").notNull(),
  email: text("email").notNull(),

  // Denormalized order number for fast access
  number: text("number").notNull(),

  // JSON array of {name, file, size, location} objects — see ADR-002.
  // Commands/Queries parse/stringify this with a zod schema.
  downloads: text("downloads").notNull().default("[]"),
});

export type FulfillmentOrder = typeof fulfillmentOrders.$inferSelect;
export type NewFulfillmentOrder = typeof fulfillmentOrders.$inferInsert;
