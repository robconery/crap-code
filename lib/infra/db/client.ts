/// <reference types="@cloudflare/workers-types" />
/**
 * Drizzle D1 client factory.
 *
 * Called once from the composition root with the D1 binding from env.
 * Returns a typed Drizzle instance that all Commands and Queries use.
 *
 * The triple-slash reference above makes D1Database available to this module
 * without requiring a separate import — drizzle-orm/d1 uses the same pattern.
 */
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./index";

export type AppDb = ReturnType<typeof createDb>;

/**
 * Creates a Drizzle ORM instance bound to the given D1 database.
 * The schema import gives Drizzle full type inference across all tables.
 */
export function createDb(d1: D1Database): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(d1, { schema });
}
