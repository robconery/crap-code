/**
 * Drizzle schema for the `pings` table.
 *
 * A Ping is the raw record of every incoming Stripe webhook event.
 * Written FIRST before any processing so every event is auditable
 * regardless of downstream failures (per ADR-003).
 *
 * Unique constraint on stripe_event_id is the idempotency guard —
 * duplicate events are detected here before any business logic runs.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const pings = sqliteTable("pings", {
  id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),

  // Natural key — Stripe guarantees event id uniqueness within an account.
  stripeEventId: text("stripe_event_id").notNull().unique(),

  eventType: text("event_type").notNull(),

  // Full Stripe event JSON stored verbatim so any replay or debugging
  // can work from the original payload without re-querying Stripe.
  rawPayload: text("raw_payload").notNull(),

  // Status lifecycle per glossary: received → fulfilled → closed | error
  status: text("status", { enum: ["received", "fulfilled", "closed", "error"] })
    .notNull()
    .default("received"),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Ping = typeof pings.$inferSelect;
export type NewPing = typeof pings.$inferInsert;
