/**
 * Drizzle Kit configuration.
 *
 * Uses SQLite dialect for local dev (D1 is SQLite-compatible).
 * Migrations are generated into /drizzle and committed — never hand-edited.
 *
 * Schema path uses a glob so drizzle-kit discovers all table definition files
 * without requiring a manual barrel update when new tables are added.
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./lib/infra/db/schema/*.ts",
  out: "./drizzle",
  // Local SQLite file for drizzle-kit introspection only.
  // The Worker uses the D1 binding (env.DATABASE) at runtime.
  dbCredentials: {
    url: ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/local.sqlite",
  },
});
