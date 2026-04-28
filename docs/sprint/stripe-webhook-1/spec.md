# 📐 Sprint Spec — stripe-webhook-1

Consolidated reference for Builder, Tester, Reviewer, and Security. The authoritative sources are `user-stories.md` (behaviour), `architecture.md` (design), and `reviewer-checklist.md` (gate criteria). This doc synthesises them into one build reference.

---

## Stack

| Concern | Technology |
|---------|-----------|
| Runtime | Bun |
| Platform | Cloudflare Worker (free tier) |
| ORM | Drizzle ORM |
| Database (local) | SQLite (via Bun) |
| Database (prod) | Cloudflare D1 |
| Email | Resend |
| File storage | Firebase Storage |
| Webhook source | Stripe |
| Lint / format | Biome |
| Types | TypeScript strict + `noUncheckedIndexedAccess` + `noImplicitOverride` + `exactOptionalPropertyTypes` |

---

## Layer Contract

```
src/routes/       ← Thin handlers: verify, parse, dispatch. No business logic.
lib/              ← Commands, Queries, domain logic. All business logic here.
lib/infra/        ← Adapters implementing ports. Only layer that imports vendor SDKs.
```

Skipping layers → Reviewer hard fail. Vendor SDK imports outside `lib/infra/` → Reviewer hard fail.

---

## Ports (interfaces in `lib/infra/`)

### `EmailSender`
```ts
interface EmailSender {
  send(opts: { to: string; from: string; subject: string; html: string }): Promise<void>;
}
```
Implementation: `ResendEmailAdapter`

### `FileStorage`
```ts
interface FileStorage {
  getSignedUrl(path: string, ttlSeconds: number): Promise<string>;
}
```
Implementation: `FirebaseFileStorageAdapter`

---

## Commands (all writes, one transaction each)

| Command | Business operation | Transaction scope |
|---------|-------------------|------------------|
| `SavePingCommand` | Persist raw Stripe event as Ping with `status=received` | Single insert |
| `UpdatePingStatusCommand` | Transition Ping status | Single update |
| `FulfillOrderCommand` | Upsert Order + User + delete/rebuild Authorization + FulfillmentOrder | One tx, 4 writes |
| `UpsertUserCommand` | Create or update User by email | Single upsert |
| `UpsertSubscriptionCommand` | Create Subscription if none exists | Single upsert |
| `UpdateSubscriptionStatusCommand` | Update Subscription.status | Single update |
| `SendFulfillmentEmailCommand` | Generate signed URLs + send email (no DB write) | No transaction |

---

## Queries (reads only, no side effects)

| Query | Returns |
|-------|---------|
| `GetOrderByCheckoutIdQuery` | `Order \| null` |
| `GetSubscriptionByStripeIdQuery` | `Subscription \| null` |
| `GetUserByEmailQuery` | `User \| null` |

---

## Webhook Event Routing (Strategy pattern — ADR-001)

| Stripe event type | Handler |
|------------------|---------|
| `checkout.session.completed` | `OrderWebhookHandler` |
| `invoice.payment_succeeded` | `SubscriptionPaymentHandler` |
| `customer.subscription.deleted` | `SubscriptionChangeHandler` |
| `customer.subscription.updated` | `SubscriptionChangeHandler` |
| *(anything else)* | Log warn, return — no error |

---

## Order Number Format

`BIGZ-` + last 8 characters of the Stripe checkout session id.  
Example: `cs_test_ABCD1234` → `BIGZ-ABCD1234`

---

## Ping Status Lifecycle

```
received → fulfilled → closed
         ↘ error (on any exception; re-processable)
```

Rules:
- `SavePingCommand` is called **before** the outer `try/catch`.
- `UpdatePingStatusCommand(error)` is called in the outer `catch` (best-effort).
- Error is **always re-thrown** after catch handling.
- Pings with `status = closed` or `status = fulfilled` → skip re-processing.
- Pings with `status = error` → re-process (not terminal).

---

## Re-fulfillment (Idempotency)

When `checkout.session.completed` arrives for an existing order:
1. Upsert `Order` on `stripe_checkout_id` conflict.
2. Upsert `User` on `email` conflict.
3. **Delete** all `authorizations` where `order_id = order.id`.
4. **Delete** all `fulfillment_orders` where `order_id = order.id`.
5. Insert new `Authorization` and `FulfillmentOrder`.
6. All of the above in one transaction.

---

## Fulfillment Email

- Template: `reference/new_order_email.html`
- From: `rob@bigmachine.io`
- To: User's email
- Signed URL TTL: **7200 seconds (2 hours)**
- Signed URLs are **NOT** persisted to DB — generated in memory, included in email, discarded.
- Offers with no downloads: email is still sent (no download section).

---

## Subscription Storage Rules

Only store what is needed for access authorization:
- `stripe_subscription_id` (unique key)
- `user_id` (FK to users)
- `status` (mirrors Stripe: `active`, `canceled`, `past_due`, etc.)

Do **not** store: billing amounts, invoice ids, plan ids, trial dates, payment method details.

---

## DB Schema Quick Reference

See `architecture.md` for full column definitions.

| Table | Natural key | Upsert conflict |
|-------|------------|----------------|
| `pings` | `stripe_event_id` | — (no upsert; unique constraint for idempotency guard) |
| `users` | `email` | `ON CONFLICT (email)` |
| `orders` | `stripe_checkout_id` | `ON CONFLICT (stripe_checkout_id)` |
| `subscriptions` | `stripe_subscription_id` | `ON CONFLICT (stripe_subscription_id)` |
| `authorizations` | — | Delete + rebuild per `order_id` |
| `fulfillment_orders` | — | Delete + rebuild per `order_id` |

---

## Error Classes

All extend `DomainError` in `lib/errors/domain.error.ts`:

| Class | File | When thrown |
|-------|------|------------|
| `StripeVerificationError` | `lib/errors/stripe-verification.error.ts` | Bad/missing Stripe signature |
| `FulfillmentError` | `lib/errors/fulfillment.error.ts` | Order fulfillment failure |
| `EmailSendError` | `lib/errors/email-send.error.ts` | Resend or template failure |
| `SubscriptionError` | `lib/errors/subscription.error.ts` | Subscription not found or update failure |

Pattern:
```ts
throw new FulfillmentError('message', { cause: originalError });
```

---

## Config / Secrets

All consumed via `AppConfig` (`lib/infra/config.ts`). Validated with zod at boot — missing vars throw immediately.

| Name | Type | Purpose |
|------|------|---------|
| `STRIPE_WEBHOOK_SECRET` | Wrangler secret | Signature verification |
| `STRIPE_API_KEY` | Wrangler secret | Stripe API calls |
| `RESEND_API_KEY` | Wrangler secret | Email dispatch |
| `FIREBASE_SERVICE_ACCOUNT` | Wrangler secret | Firebase signed URLs (JSON string) |
| `DATABASE` | D1 binding | Drizzle DB access |

---

## Logging

All logs via `Logger` (`lib/infra/logger.ts`). No `console.log` anywhere.

Structured format: `{ ts, level, event, context, correlationId }`  
Correlation ID = Stripe event id, threaded through every service.

Mandatory log events:
- Route entry / exit
- Command start / commit / rollback
- Every external call (Stripe, Resend, Firebase) with duration
- Every caught error before rethrow

Never log: raw email bodies, full card data, raw webhook payloads (those live in `ping.raw_payload`).

---

## Test Strategy

- Unit tests: service classes with fake adapters.
- Integration tests: every Command + real in-memory SQLite + fake adapters.
- No E2E: no real Stripe / Resend / Firebase in tests.
- Fakes in `tests/fakes/`: `FakeEmailSender`, `FakeFileStorage`.
- Fixtures in `tests/fixtures/`: 4 Stripe event JSON files.
- BDD naming: `describe` → context, `it` → observable outcome.
