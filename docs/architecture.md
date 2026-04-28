# 🏛 Architecture — bigmachine.io Fulfillment Worker

_Living document. Updated at sprint close. See `docs/sprint/*/architecture.md` for sprint-specific detail._

---

## Current State (post sprint/stripe-webhook-1)

A Cloudflare Worker that handles Stripe webhook events for order fulfillment and subscription management.

## Stack

| Concern | Technology |
|---------|-----------|
| Runtime | Bun (local) / Cloudflare Workers (prod) |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Email | Resend |
| File storage | Firebase Storage |
| Webhook source | Stripe |
| Types | TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |

## Layering (Hex-Lite)

```
src/routes/       ← Thin handlers: verify, parse, dispatch. No business logic.
lib/              ← Commands, Queries, domain logic.
lib/infra/        ← Adapters implementing ports. Only layer that imports vendor SDKs.
```

## Key Patterns

- **Strategy (ADR-001):** `WebhookRouter` dispatches via `Map<string, WebhookHandler>`.
- **Command:** All writes are discrete Command classes with `execute()`.
- **Query:** Read-only operations separated from writes.
- **Adapter (Ports & Adapters):** `EmailSender`, `FileStorage` ports with swap-safe concrete adapters.
- **Composition Root:** `lib/composition-root.ts` is the single DI wiring point.

## Idempotency

- `pings.stripe_event_id` — UNIQUE constraint prevents duplicate Ping rows
- `users.email` — `ON CONFLICT DO UPDATE` upsert
- `orders.stripe_checkout_id` — `ON CONFLICT DO UPDATE` upsert
- `subscriptions.stripe_subscription_id` — `ON CONFLICT DO NOTHING`
- `authorizations`, `fulfillment_orders` — delete+rebuild per `order_id` inside one transaction

## Ping Lifecycle

```
received → fulfilled → closed
         ↘ error (re-processable; not terminal)
```

`SavePingCommand` runs **before** the outer try/catch on the webhook route so every event is audited.

## Known Gaps (post sprint-1)

- `FIREBASE_STORAGE_BUCKET` env var not in `.dev.vars.example` or `config.ts`
- `OrderWebhookHandler` passes `downloads: []` to `FulfillOrderCommand` — product download metadata not yet in Stripe checkout metadata

## Updates (post polish-1)

### Testing infrastructure

- `tests/helpers/create-test-db.ts` — shared factory using `drizzle-orm/bun-sqlite/migrator`. All integration tests now call `createTestDb()` rather than hand-rolling DDL strings. Single source of truth: `drizzle/0000_milky_meggan.sql`.
- All integration test files restructured to BDD `describe`/`beforeEach`/`afterEach` pattern — one scenario per `describe`, multiple focused `it` assertions.

### Config

- `FIREBASE_STORAGE_BUCKET` added to `configSchema` in `lib/infra/config.ts` — now validated at boot via zod (fail-fast). Added to `.dev.vars.example`.

### Known Gaps (revised)

- ~~`FIREBASE_STORAGE_BUCKET` env var not in `.dev.vars.example` or `config.ts`~~ — **fixed in polish-1**.
- `OrderWebhookHandler` passes `downloads: []` to `FulfillOrderCommand` — product download metadata not yet in Stripe checkout metadata. Future sprint item.
