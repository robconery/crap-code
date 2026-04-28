import { FulfillmentError } from "@/lib/errors/fulfillment.error";
import { pings } from "@/lib/infra/db";
import type { Ping } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
/**
 * UpdatePingStatusCommand — transitions a Ping to a new status.
 *
 * Called multiple times during the webhook pipeline:
 *   received → fulfilled  (after FulfillOrderCommand commits)
 *   fulfilled → closed    (after SendFulfillmentEmailCommand succeeds)
 *   * → error             (in the outer catch block, before rethrowing)
 *
 * Throws FulfillmentError rather than silently no-oping when the Ping row
 * cannot be found — a missing Ping is a bug, not an expected flow.
 */
import { eq } from "drizzle-orm";

export type PingStatus = "received" | "fulfilled" | "closed" | "error";

export interface UpdatePingStatusInput {
  pingId: number;
  status: PingStatus;
}

export class UpdatePingStatusCommand {
  readonly #db: AppDb;
  readonly #logger: Logger;

  constructor(db: AppDb, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Updates the Ping status and updatedAt timestamp.
   *
   * @throws {FulfillmentError} if no Ping row exists for the given pingId.
   */
  async execute(input: UpdatePingStatusInput): Promise<Ping> {
    this.#logger.info("ping.status.update", { pingId: input.pingId, status: input.status });

    const updated = await this.#db
      .update(pings)
      .set({ status: input.status, updatedAt: new Date().toISOString() })
      .where(eq(pings.id, input.pingId))
      .returning()
      .get();

    if (!updated) {
      throw new FulfillmentError(`Ping not found for id ${input.pingId} — cannot update status`);
    }

    this.#logger.info("ping.status.ok", { pingId: input.pingId, status: input.status });
    return updated;
  }
}
