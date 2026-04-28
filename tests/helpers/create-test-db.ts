/**
 * createTestDb — shared in-memory database factory for integration tests.
 *
 * WHY this exists: every test file previously hand-rolled its own DDL strings,
 * duplicating the real schema and creating a maintenance hazard (schema change →
 * update N test files). This helper runs the generated Drizzle migration against
 * an in-memory SQLite instance, so there is exactly ONE source of truth for the
 * table definitions: lib/infra/db/schema/*.ts → drizzle/0000_*.sql.
 *
 * Usage:
 *   const { db, sqlite } = createTestDb();
 *   // run commands against db ...
 *   sqlite.close(); // in afterEach
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import * as schema from "@/lib/infra/db";
import type { AppDb } from "@/lib/infra/db/client";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

// Resolve from repo root so the path works regardless of where bun test is invoked.
// import.meta.dir is this file's directory (tests/helpers/); we step up two levels.
const MIGRATIONS_FOLDER = join(import.meta.dir, "../../drizzle");

export interface TestDb {
  /** Typed Drizzle db instance — use for all ORM operations in tests. */
  db: AppDb;
  /**
   * Raw Bun SQLite handle — use only for seeding data and asserting raw DB
   * state that Drizzle doesn't expose (e.g. COUNT(*) queries in assertions).
   * Close this in afterEach to free the in-memory database.
   */
  sqlite: Database;
}

/**
 * Creates a fresh in-memory SQLite database and runs the generated Drizzle
 * migrations against it. Returns both the Drizzle AppDb and the raw SQLite
 * handle for seeding and assertions.
 *
 * Each call returns a fully isolated instance — safe to call once per
 * beforeEach without any shared state between tests.
 */
export function createTestDb(): TestDb {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });

  // Run generated migrations rather than hand-writing DDL in each test.
  // This guarantees tests run against the same schema as production.
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return { db: db as unknown as AppDb, sqlite };
}
