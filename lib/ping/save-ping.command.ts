import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import { pings } from "@/lib/infra/db";
import type { Ping } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
/**
 * SavePingCommand — persists the raw Stripe webhook event as a Ping record.
 *
 * FIRST operation in the webhook pipeline, executed BEFORE any try/catch block
 * (per ADR-003). Every event is auditable regardless of downstream failures.
 *
 * Idempotency model (one Ping per stripe_event_id):
 *  - closed/fulfilled → skip, return shouldSkip:true (already processed)
 *  - error            → reset to 'received' in place (re-processable per AC 8.5)
 *  - none             → insert fresh Ping with status='received'
 *
 * The UNIQUE constraint on stripe_event_id enforces one-row-per-event at the DB
 * level, so the error reset uses UPDATE rather than a second INSERT.
 */
import { eq } from "drizzle-orm";

export interface SavePingInput {
  stripeEventId: string;
  eventType: string;
  rawPayload: string;
}

export type SavePingResult = { shouldSkip: true; ping: Ping } | { shouldSkip: false; ping: Ping };

export class SavePingCommand {
  readonly #db: AppDb;
  readonly #logger: Logger;

  constructor(db: AppDb, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Saves or resets the Ping for the given Stripe event.
   * Returns shouldSkip:true for already-processed events (closed/fulfilled).
   */
  async execute(input: SavePingInput): Promise<SavePingResult> {
    this.#logger.info("ping.save.start", { stripeEventId: input.stripeEventId });

    const existing = await this.#db
      .select()
      .from(pings)
      .where(eq(pings.stripeEventId, input.stripeEventId))
      .get();

    if (existing) {
      if (existing.status === "closed" || existing.status === "fulfilled") {
        // Successfully processed — do not reprocess (AC 2.5)
        this.#logger.info("ping.save.skip", {
          stripeEventId: input.stripeEventId,
          status: existing.status,
        });
        return { shouldSkip: true, ping: existing };
      }

      // status=error — reset in place so the event can be re-processed (AC 8.5)
      // UPDATE rather than INSERT because stripe_event_id has a UNIQUE constraint.
      this.#logger.info("ping.save.retry", { stripeEventId: input.stripeEventId });
      const reset = await this.#db
        .update(pings)
        .set({ status: "received", updatedAt: new Date().toISOString() })
        .where(eq(pings.id, existing.id))
        .returning()
        .get();

      if (!reset) {
        throw new FulfillmentError(`Failed to reset error ping for ${input.stripeEventId}`);
      }
      this.#logger.info("ping.save.ok", { pingId: reset.id, stripeEventId: input.stripeEventId });
      return { shouldSkip: false, ping: reset };
    }

    const now = new Date().toISOString();
    const inserted = await this.#db
      .insert(pings)
      .values({
        stripeEventId: input.stripeEventId,
        eventType: input.eventType,
        rawPayload: input.rawPayload,
        status: "received",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    this.#logger.info("ping.save.ok", { pingId: inserted.id, stripeEventId: input.stripeEventId });
    return { shouldSkip: false, ping: inserted };
  }
}
