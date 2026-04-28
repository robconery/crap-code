# ADR-002: Downloads Stored as JSON Column on FulfillmentOrder

**Status:** Accepted  
**Sprint:** stripe-webhook-1  
**Date:** 2026-04-22

---

## Context

`FulfillmentOrder` records contain a variable-length list of download items (`name`, `file`, `size`, `location`). The reference schema in `reference/fulfillment.json` models this as an embedded array. Options considered:

1. **Separate `downloads` table** with FK to `fulfillment_orders`
2. **JSON text column** on `fulfillment_orders`

## Decision

Store `downloads` as a **JSON text column** (`TEXT NOT NULL DEFAULT '[]'`).

Reasons:
- Downloads are always read and written as a unit alongside the parent `FulfillmentOrder`. There is no query in the system that needs to filter or join on individual download rows.
- D1 (SQLite) supports JSON extraction functions if needed in future.
- Eliminates a join and a child-table delete/rebuild cycle on re-fulfillment.
- Simpler schema, fewer migration risks on the free-tier D1.

Drizzle will type this as `string` at the ORM level; Commands/Queries are responsible for `JSON.parse`/`JSON.stringify` with a zod schema validation on parse.

## Consequences

✅ Simpler schema and re-fulfillment logic.  
✅ Atomic read/write with parent record.  
⚠️ Cannot query individual download rows via SQL. Acceptable — no such query is required.  
⚠️ Raw string in DB. Mitigated by zod validation on every parse.
