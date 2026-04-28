# 🏛 Architecture — sprint/stripe-webhook-1

## Goal
Stripe webhook receiver running on Cloudflare Workers (free tier). Handles one-time order fulfillment and subscription lifecycle events. Idempotent, auditable, no crap code.

---

## 🗂 Directory Layout

```
src/
  index.ts                          ← Cloudflare Worker entry (binds env, calls composition root)
  routes/
    webhook.ts                      ← POST /webhook — thin: verify sig, save ping, dispatch

lib/
  composition-root.ts               ← Single DI wiring point. No framework.
  errors/
    domain.error.ts                 ← Base DomainError extends Error
    stripe-verification.error.ts
    fulfillment.error.ts
    email-send.error.ts
    subscription.error.ts
  contracts/
    stripe-webhook.schema.ts        ← Zod schemas for every Stripe event type we handle
  infra/
    config.ts                       ← AppConfig: reads env bindings, validates with zod, fail-fast
    logger.ts                       ← Structured JSON logger — ONLY logging surface in the codebase
    db/
      client.ts                     ← Drizzle D1 client factory
      schema/
        pings.ts
        users.ts
        orders.ts
        authorizations.ts
        fulfillment-orders.ts
        subscriptions.ts
      index.ts                      ← Re-exports all schema tables
    email/
      email-sender.port.ts          ← Port: EmailSender interface
      resend-email.adapter.ts       ← Adapter: ResendEmailSender implements EmailSender
    storage/
      file-storage.port.ts          ← Port: FileStorage interface
      firebase-file-storage.adapter.ts  ← Adapter: FirebaseFileStorage implements FileStorage
    stripe/
      stripe-verifier.adapter.ts    ← Stripe signature verification (wraps Stripe SDK)
  ping/
    save-ping.command.ts
    update-ping-status.command.ts
  orders/
    fulfill-order.command.ts        ← Upsert Order + User + Auth + Fulfillment in one tx
    get-order-by-checkout-id.query.ts
  users/
    upsert-user.command.ts
    get-user-by-email.query.ts
  subscriptions/
    upsert-subscription.command.ts
    update-subscription-status.command.ts
    get-subscription-by-stripe-id.query.ts
  email/
    send-fulfillment-email.command.ts  ← Generates signed URLs (via FileStorage port), sends email
  webhooks/
    webhook-router.ts               ← Strategy dispatcher: maps event type → handler
    handlers/
      order-webhook.handler.ts      ← Strategy: checkout.session.completed
      subscription-payment.handler.ts  ← Strategy: invoice.payment_succeeded
      subscription-change.handler.ts   ← Strategy: customer.subscription.deleted/updated

tests/
  fixtures/
    stripe-checkout-event.json
    stripe-subscription-payment-event.json
    stripe-subscription-cancel-event.json
    stripe-subscription-update-event.json
  fakes/
    fake-email-sender.ts
    fake-file-storage.ts
  lib/
    ping/
      save-ping.command.test.ts
      update-ping-status.command.test.ts
    orders/
      fulfill-order.command.test.ts
    users/
      upsert-user.command.test.ts
    subscriptions/
      upsert-subscription.command.test.ts
      update-subscription-status.command.test.ts
    email/
      send-fulfillment-email.command.test.ts
    webhooks/
      webhook-router.test.ts
      handlers/
        order-webhook.handler.test.ts
        subscription-payment.handler.test.ts
        subscription-change.handler.test.ts
```

---

## 🏗 Layering (Hex-Lite)

```
[Cloudflare Worker / Route]     ← src/routes/webhook.ts
       ↓ calls only
[Domain Services / Commands / Queries]   ← lib/
       ↓ calls only via interfaces (ports)
[Infra Adapters]                ← lib/infra/
       ↓ calls
[Vendors: Drizzle/D1, Resend, Firebase, Stripe SDK]
```

**Enforcement rules:**
- `routes/` may call `lib/` only. Never imports from `lib/infra/` directly.
- `lib/` service classes depend on **port interfaces**, never on concrete adapter classes.
- `lib/infra/` is the only layer that may import vendor SDKs.
- Violations are a Reviewer **hard fail**.

---

## 🧱 Patterns & Justifications

### Command (GoF: Command Pattern)
**Reason:** Every business write is a discrete, named operation with a single `execute()` method wrapping all writes in one transaction. This enforces SRP (one class = one write concern) and makes retries, logging, and testing trivial. Every Command is its own unit of failure.

Commands in this sprint:
| Command | Responsibility |
|---------|---------------|
| `SavePingCommand` | Persists raw Stripe event as a Ping |
| `UpdatePingStatusCommand` | Transitions Ping status |
| `FulfillOrderCommand` | Upserts Order + User + Authorization + FulfillmentOrder in one transaction |
| `UpsertUserCommand` | Creates or updates User by email |
| `UpsertSubscriptionCommand` | Creates Subscription if none exists for that stripe_subscription_id |
| `UpdateSubscriptionStatusCommand` | Updates Subscription.status on lifecycle events |
| `SendFulfillmentEmailCommand` | Generates signed download URLs, sends email via EmailSender port |

### Query
**Reason:** Read-only operations are cleanly separated from writes so that reads can never accidentally mutate state. One class = one read concern.

Queries in this sprint:
| Query | Returns |
|-------|---------|
| `GetOrderByCheckoutIdQuery` | Order or null |
| `GetSubscriptionByStripeIdQuery` | Subscription or null |
| `GetUserByEmailQuery` | User or null |

### Strategy (GoF: Strategy Pattern)
**Reason:** The webhook endpoint receives heterogeneous Stripe event types, each requiring a completely different processing path. Rather than a growing `if/switch` in the route handler, each event type maps to a named handler strategy implementing a shared `WebhookHandler` interface. Adding a new event type = adding a new strategy class; the router never changes. See **ADR-001**.

```
WebhookHandler (interface)
  ├── OrderWebhookHandler        (checkout.session.completed)
  ├── SubscriptionPaymentHandler (invoice.payment_succeeded)
  └── SubscriptionChangeHandler  (customer.subscription.deleted / .updated)
```

### Adapter (GoF: Adapter Pattern)
**Reason:** Vendor implementations (Resend, Firebase, Stripe SDK) must be swappable. Each port interface is defined in `lib/` domain-space; adapters in `lib/infra/` implement the interface and translate vendor API calls into domain calls. Fakes in tests replace adapters without changing domain logic.

Ports and their adapters:
| Port | Adapter |
|------|---------|
| `EmailSender` | `ResendEmailAdapter` |
| `FileStorage` | `FirebaseFileStorageAdapter` |

---

## 🗄 Database Schema (Drizzle / D1 + SQLite)

### `pings`
| Column | Type | Notes |
|--------|------|-------|
| id | integer (pk, autoincrement) | |
| stripe_event_id | text (unique, not null) | Natural key — idempotency guard |
| event_type | text (not null) | e.g. `checkout.session.completed` |
| raw_payload | text (not null) | Full JSON string of Stripe event |
| status | text (not null) | `received` \| `fulfilled` \| `closed` \| `error` |
| created_at | text (not null) | ISO 8601 |
| updated_at | text (not null) | ISO 8601 |

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | integer (pk, autoincrement) | |
| email | text (unique, not null) | Conflict key for upsert |
| name | text | Nullable — subscriptions may not have name |
| stripe_customer_id | text | |
| created_at | text (not null) | |

### `orders`
| Column | Type | Notes |
|--------|------|-------|
| id | integer (pk, autoincrement) | |
| stripe_checkout_id | text (unique, not null) | Natural key — upsert conflict key |
| number | text (unique, not null) | `BIGZ-{last-8}` |
| user_id | integer (fk → users.id) | |
| store | text | |
| slug | text | Offer slug |
| email | text | Denormalized for fast lookup |
| file | text | Nullable |
| resource_type | text | Nullable |
| amount_total | integer | Cents |
| currency | text | |
| offer | text | Offer name |
| created_at | text | |

### `authorizations`
| Column | Type | Notes |
|--------|------|-------|
| id | integer (pk, autoincrement) | |
| order_id | integer (fk → orders.id) | Cascade-deleted on re-fulfillment |
| date | text | |
| sku | text | |
| email | text | |
| number | text | Order number |

### `fulfillment_orders`
| Column | Type | Notes |
|--------|------|-------|
| id | integer (pk, autoincrement) | |
| order_id | integer (fk → orders.id) | Cascade-deleted on re-fulfillment |
| date | text | |
| sku | text | |
| email | text | |
| number | text | Order number |
| downloads | text | JSON array of `{name, file, size, location}` — see ADR-002 |

### `subscriptions`
| Column | Type | Notes |
|--------|------|-------|
| id | integer (pk, autoincrement) | |
| stripe_subscription_id | text (unique, not null) | Natural key |
| user_id | integer (fk → users.id) | |
| status | text (not null) | Mirrors Stripe status: `active` \| `canceled` \| `past_due` etc. |
| created_at | text | |
| updated_at | text | |

> **Note:** Stripe API is the source of truth for subscription billing details. Only access-authorization fields are stored locally.

---

## 🔄 Request Flow: Order Fulfillment

```
POST /webhook
  → StripeVerifierAdapter.verify()         ← throws StripeVerificationError on bad sig
  → SavePingCommand.execute()              ← OUTSIDE try/catch (see ADR-003)
  → try {
      webhook-router → OrderWebhookHandler.handle()
        → FulfillOrderCommand.execute()    ← one transaction:
            upsert User
            upsert Order
            delete existing Authorizations for order_id
            delete existing FulfillmentOrders for order_id
            insert Authorization
            insert FulfillmentOrder
            commit
        → UpdatePingStatusCommand(fulfilled)
        → SendFulfillmentEmailCommand.execute()
            → FileStorage.getSignedUrl() per download (not persisted)
            → EmailSender.send()
        → UpdatePingStatusCommand(closed)
    } catch (err) {
        UpdatePingStatusCommand(error)   ← best-effort
        console.error(...)
        throw err                         ← rethrow for Cloudflare logs
    }
  → return 200
```

## 🔄 Request Flow: Subscription Events

```
POST /webhook
  → verify + save Ping (same as above)
  → try {
      webhook-router → SubscriptionPaymentHandler | SubscriptionChangeHandler
        → UpsertUserCommand.execute()
        → UpsertSubscriptionCommand.execute()  (or UpdateSubscriptionStatusCommand)
        → UpdatePingStatusCommand(fulfilled)
        → UpdatePingStatusCommand(closed)
    } catch (err) {
        UpdatePingStatusCommand(error)
        console.error(...)
        throw err
    }
```

---

## 📦 Key Dependencies

| Package | Purpose |
|---------|---------|
| `stripe` | Webhook verification + Stripe API |
| `drizzle-orm` + `@cloudflare/d1` | ORM against Cloudflare D1 |
| `resend` | Transactional email |
| `firebase-admin` or Firebase Storage REST | Signed URL generation |
| `zod` | Schema validation for all external inputs and config |
| `biome` | Lint + format |

---

## 🔐 Config / Secrets

All resolved at boot via `AppConfig` (`lib/infra/config.ts`), validated with zod. Hard-fail if missing:

- `STRIPE_WEBHOOK_SECRET` — Wrangler secret
- `STRIPE_API_KEY` — Wrangler secret (subscription queries)
- `RESEND_API_KEY` — Wrangler secret
- `FIREBASE_SERVICE_ACCOUNT` — Wrangler secret (JSON string)
- `DATABASE` — D1 binding

---

## 🔗 Glossary Additions (flagged by PO — Architect confirms)

Two new terms added to `/docs/glossary.md`:
- **`stripe_customer_id`** — The Stripe customer identifier stored on `User` and used to correlate subscriptions. Not the primary key; email is the upsert conflict key.
- **`billing_reason`** — A field on Stripe's `Invoice` object (`subscription_create` | `subscription_cycle` | `manual`) used by `SubscriptionPaymentHandler` to distinguish initial subscription creation from renewal.
