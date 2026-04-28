import { users } from "@/lib/infra/db";
import type { User } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import type { Logger } from "@/lib/infra/logger";
/**
 * UpsertUserCommand — creates or updates a User record by email.
 *
 * Email is the canonical conflict key (per architecture.md). Used standalone
 * for subscription fulfillment. FulfillOrderCommand handles its own user upsert
 * inline to keep all 4 order writes in one transaction.
 */
import { eq } from "drizzle-orm";

export interface UpsertUserInput {
  email: string;
  name?: string;
  stripeCustomerId?: string;
}

export class UpsertUserCommand {
  readonly #db: AppDb;
  readonly #logger: Logger;

  constructor(db: AppDb, logger: Logger) {
    this.#db = db;
    this.#logger = logger;
  }

  /**
   * Inserts a new User or updates the existing one on email conflict.
   * Returns the persisted User record.
   */
  async execute(input: UpsertUserInput): Promise<User> {
    this.#logger.info("user.upsert.start", { email: input.email });

    const now = new Date().toISOString();
    const result = await this.#db
      .insert(users)
      .values({
        email: input.email,
        name: input.name ?? null,
        stripeCustomerId: input.stripeCustomerId ?? null,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: users.email,
        // Update supplemental fields on conflict — email (the key) is not changed
        set: {
          name: input.name ?? null,
          stripeCustomerId: input.stripeCustomerId ?? null,
        },
      })
      .returning()
      .get();

    this.#logger.info("user.upsert.ok", { userId: result.id });
    return result;
  }
}
