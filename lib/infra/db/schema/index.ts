/**
 * Schema barrel — re-exports every Drizzle table definition so drizzle-kit
 * can discover them via a single entry point in drizzle.config.ts.
 *
 * Why a separate barrel here (vs. lib/infra/db/index.ts): drizzle-kit reads
 * the schema path at build time; keeping it in schema/ makes the config path
 * unambiguous and avoids pulling type-only exports into the kit pass.
 */
export { authorizations } from "./authorizations";
export { fulfillmentOrders } from "./fulfillment-orders";
export { orders } from "./orders";
export { pings } from "./pings";
export { subscriptions } from "./subscriptions";
export { users } from "./users";
