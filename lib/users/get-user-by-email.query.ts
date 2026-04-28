import { users } from "@/lib/infra/db";
import type { User } from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
/**
 * GetUserByEmailQuery — returns a User by email, or null if not found.
 *
 * Read-only. Never writes, not even updated_at — per CQS rules.
 */
import { eq } from "drizzle-orm";

export interface GetUserByEmailInput {
  email: string;
}

export class GetUserByEmailQuery {
  readonly #db: AppDb;

  constructor(db: AppDb) {
    this.#db = db;
  }

  /** Returns the User for the given email, or null if none exists. */
  async run(input: GetUserByEmailInput): Promise<User | null> {
    const result = await this.#db.select().from(users).where(eq(users.email, input.email)).get();

    return result ?? null;
  }
}
