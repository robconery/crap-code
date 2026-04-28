# 📋 Sprint Plan — stripe-webhook-1

**13 tasks, 9 waves.** Tasks in the same wave never touch the same files. Each wave completes fully (all gates green) before the next wave begins.

---

## Wave Map

```
Wave 1 ──────── task-1 (scaffolding)
                   │
Wave 2 ──────── task-2 (DB schema)  ║  task-3 (config + logger + errors)
                   │                         │
Wave 3 ──────── task-4 (Stripe verifier + contracts)  ║  task-5 (Email + Storage adapters)
                   │                                            │
Wave 4 ──────── task-6 (Ping commands)
                   │
Wave 5 ──────── task-7 (User commands)  ║  task-8 (FulfillOrderCommand)
                   │                              │
Wave 6 ──────── task-9 (Email command)  ║  task-10 (Subscription commands)
                   │                              │
Wave 7 ──────── task-11 (WebhookRouter + OrderWebhookHandler)
                   │
Wave 8 ──────── task-12 (Subscription handlers)
                   │
Wave 9 ──────── task-13 (Route handler + composition root)
```

---

## Wave 1

### task-1: Project Scaffolding
Story: Foundation for all stories  
Wave: 1  
Depends-on: []  
Files:
  - `package.json`
  - `tsconfig.json`
  - `wrangler.toml`
  - `biome.json`
  - `.dev.vars.example`
  - `.gitignore`
  - `src/index.ts`

**What to build:**
- `package.json` with all dependencies: `stripe`, `drizzle-orm`, `@cloudflare/d1`, `resend`, `firebase-admin`, `zod`, `@cloudflare/workers-types`
- `devDependencies`: `drizzle-kit`, `wrangler`, `@biomejs/biome`, `typescript`, `bun-types`
- `tsconfig.json`: `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, path aliases `@/lib/*` → `./lib/*`, `@/tests/*` → `./tests/*`
- `wrangler.toml`: Worker name, D1 database binding (`DATABASE`), compatibility date
- `biome.json`: Lint + format config; enforce no `console.log` rule
- `.dev.vars.example`: Document all required secrets (no values)
- `.gitignore`: `node_modules/`, `.wrangler/`, `.dev.vars`, `*.sqlite`, `dist/`
- `src/index.ts`: Minimal Worker entry — exports `default { fetch }`, composition root placeholder

---

## Wave 2

### task-2: Database Schema + Drizzle Client
Story: Story 2, 3, 5, 6, 7 (all persistence)  
Wave: 2  
Depends-on: [task-1]  
Files:
  - `lib/infra/db/schema/pings.ts`
  - `lib/infra/db/schema/users.ts`
  - `lib/infra/db/schema/orders.ts`
  - `lib/infra/db/schema/authorizations.ts`
  - `lib/infra/db/schema/fulfillment-orders.ts`
  - `lib/infra/db/schema/subscriptions.ts`
  - `lib/infra/db/index.ts`
  - `lib/infra/db/client.ts`
  - `drizzle.config.ts`

**What to build:**
- One Drizzle schema file per table (see `architecture.md` for column definitions)
- Unique constraints: `pings.stripe_event_id`, `users.email`, `orders.stripe_checkout_id`, `subscriptions.stripe_subscription_id`
- `downloads` column on `fulfillment_orders` is `text` (JSON array — per ADR-002)
- `client.ts`: exports `createDb(d1: D1Database): DrizzleD1Database` — used by composition root
- `drizzle.config.ts`: points to schema index, SQLite dialect for local dev
- Run `bunx drizzle-kit generate` to produce migrations (commit generated files)

---

### task-3: Config, Logger, and Error Classes
Story: Story 8 (error handling), all stories (logging + config)  
Wave: 2  
Depends-on: [task-1]  
Files:
  - `lib/infra/config.ts`
  - `lib/infra/logger.ts`
  - `lib/errors/domain.error.ts`
  - `lib/errors/stripe-verification.error.ts`
  - `lib/errors/fulfillment.error.ts`
  - `lib/errors/email-send.error.ts`
  - `lib/errors/subscription.error.ts`

**What to build:**
- `AppConfig`: zod schema for all env bindings; exported typed object; throws on missing required vars
- `Logger`: structured JSON logger, levels `debug/info/warn/error`; constructor takes `correlationId`; exposes `.info()`, `.warn()`, `.error()` — **no `console.log` passthrough**
- `DomainError`: base class extending `Error`, accepts `cause`
- Four domain error subclasses — each with a descriptive message and `{ cause }` support

---

## Wave 3

### task-4: Stripe Verifier Adapter + Webhook Contracts
Story: Story 1 (signature verification), all stories (input validation)  
Wave: 3  
Depends-on: [task-2, task-3]  
Files:
  - `lib/infra/stripe/stripe-verifier.adapter.ts`
  - `lib/contracts/stripe-webhook.schema.ts`
  - `tests/lib/infra/stripe/stripe-verifier.adapter.test.ts`
  - `tests/fixtures/stripe-checkout-event.json` *(fill in with valid fixture)*
  - `tests/fixtures/stripe-subscription-payment-event.json` *(fill in)*
  - `tests/fixtures/stripe-subscription-cancel-event.json` *(fill in)*
  - `tests/fixtures/stripe-subscription-update-event.json` *(fill in)*

**What to build:**
- `StripeVerifierAdapter`: wraps `stripe.webhooks.constructEvent(body, sig, secret)`, throws `StripeVerificationError` on failure. Returns the parsed Stripe event.
- `stripe-webhook.schema.ts`: zod schemas for each handled event type. Use `z.discriminatedUnion` on `type`. Inferred types are canonical for `lib/`.
- Fill in the 4 fixture JSON files with valid (anonymised) Stripe event shapes.
- Tests cover: valid sig passes (AC 1.1, 1.3), missing sig throws (AC 1.2), invalid sig throws (AC 1.2).

---

### task-5: Email Sender + File Storage Adapters
Story: Story 4 (download links + email)  
Wave: 3  
Depends-on: [task-2, task-3]  
Files:
  - `lib/infra/email/email-sender.port.ts`
  - `lib/infra/email/resend-email.adapter.ts`
  - `lib/infra/storage/file-storage.port.ts`
  - `lib/infra/storage/firebase-file-storage.adapter.ts`
  - `tests/fakes/fake-email-sender.ts` *(implement the interface)*
  - `tests/fakes/fake-file-storage.ts` *(implement the interface)*

**What to build:**
- `EmailSender` port interface: `send(opts: SendEmailOpts): Promise<void>`
- `ResendEmailAdapter`: implements `EmailSender`, uses Resend SDK, logs send with duration
- `FileStorage` port interface: `getSignedUrl(path: string, ttlSeconds: number): Promise<string>`
- `FirebaseFileStorageAdapter`: implements `FileStorage`, generates Firebase signed URLs
- `FakeEmailSender`: records calls, exposes `sentEmails` array for test assertions
- `FakeFileStorage`: returns deterministic URLs (`https://fake-storage/${path}?ttl=${ttlSeconds}`)

---

## Wave 4

### task-6: Ping Commands
Story: Story 2 (all ACs), Story 8 AC2, AC3  
Wave: 4  
Depends-on: [task-2, task-3]  
Files:
  - `lib/ping/save-ping.command.ts`
  - `lib/ping/update-ping-status.command.ts`
  - `tests/lib/ping/save-ping.command.test.ts`
  - `tests/lib/ping/update-ping-status.command.test.ts`

**What to build:**
- `SavePingCommand.execute({ stripeEventId, eventType, rawPayload })`:
  - Checks for existing Ping by `stripe_event_id`
  - If `status = closed` or `status = fulfilled` → returns existing Ping (duplicate skip)
  - If `status = error` or none exists → inserts new Ping with `status = received`
  - Returns `{ ping, shouldSkip: boolean }`
- `UpdatePingStatusCommand.execute({ pingId, status })`:
  - Updates `pings.status` + `updated_at` for the given id
  - Throws `FulfillmentError` if ping not found
- Integration tests use real in-memory SQLite (Bun's built-in SQLite + Drizzle)

---

## Wave 5

### task-7: User Commands + Query
Story: Story 3 AC4, Story 5 AC4, Story 6 AC1  
Wave: 5  
Depends-on: [task-6]  
Files:
  - `lib/users/upsert-user.command.ts`
  - `lib/users/get-user-by-email.query.ts`
  - `tests/lib/users/upsert-user.command.test.ts`

**What to build:**
- `UpsertUserCommand.execute({ email, name?, stripeCustomerId? })`:
  - `INSERT INTO users ... ON CONFLICT (email) DO UPDATE SET ...`
  - Returns the upserted User
- `GetUserByEmailQuery.run({ email })`: returns `User | null`
- Integration tests: new user created (AC 3.4), existing user updated (AC 5.4), stripe_customer_id stored (AC 6.1)

---

### task-8: FulfillOrderCommand + Query
Story: Story 3 (all ACs), Story 5 (all ACs)  
Wave: 5  
Depends-on: [task-6]  
Files:
  - `lib/orders/fulfill-order.command.ts`
  - `lib/orders/get-order-by-checkout-id.query.ts`
  - `tests/lib/orders/fulfill-order.command.test.ts`

**What to build:**
- `FulfillOrderCommand.execute({ stripeCheckoutId, customerEmail, customerName, stripeCustomerId, amountTotal, currency, offer, store, slug, downloads })`:
  - Derives order number: `BIGZ-` + last 8 chars of `stripeCheckoutId`
  - Logs order number before any DB write (AC 3.7)
  - Opens one transaction:
    1. `INSERT INTO users ... ON CONFLICT (email) DO UPDATE SET ...`
    2. `INSERT INTO orders ... ON CONFLICT (stripe_checkout_id) DO UPDATE SET ...`
    3. `DELETE FROM authorizations WHERE order_id = ?`
    4. `DELETE FROM fulfillment_orders WHERE order_id = ?`
    5. `INSERT INTO authorizations ...`
    6. `INSERT INTO fulfillment_orders ...` (downloads as JSON string)
  - Commits; returns `{ order, user, authorization, fulfillmentOrder }`
- `GetOrderByCheckoutIdQuery.run({ stripeCheckoutId })`: returns `Order | null`
- Integration tests: new order (AC 3.1–3.7), rollback on failure (AC 3.5 sad), re-fulfillment (AC 5.1–5.5)

> **Note:** `FulfillOrderCommand` handles its own user upsert inline to keep all 4 writes in one transaction. It does **not** delegate to `UpsertUserCommand`.

---

## Wave 6

### task-9: Send Fulfillment Email Command
Story: Story 4 (all ACs)  
Wave: 6  
Depends-on: [task-5, task-8]  
Files:
  - `lib/email/send-fulfillment-email.command.ts`
  - `tests/lib/email/send-fulfillment-email.command.test.ts`

**What to build:**
- `SendFulfillmentEmailCommand.execute({ user, fulfillmentOrder, offer })`:
  - For each download in `fulfillmentOrder.downloads`: call `FileStorage.getSignedUrl(path, 7200)`
  - Build HTML from `reference/new_order_email.html` template (string interpolation or a minimal template engine — no external dep)
  - Call `EmailSender.send({ to: user.email, from: 'rob@bigmachine.io', subject: '...', html })`
  - Does **not** persist signed URLs to DB
  - Throws `EmailSendError` on failure (wraps cause)
- Constructor injects: `FileStorage`, `EmailSender`, `Logger`
- Tests use `FakeEmailSender` and `FakeFileStorage`
- Tests: with downloads (AC 4.1–4.4), no downloads (AC 4.5), email failure throws (sad path)

---

### task-10: Subscription Commands + Query
Story: Story 6 (all ACs), Story 7 AC1–AC4  
Wave: 6  
Depends-on: [task-7]  
Files:
  - `lib/subscriptions/upsert-subscription.command.ts`
  - `lib/subscriptions/update-subscription-status.command.ts`
  - `lib/subscriptions/get-subscription-by-stripe-id.query.ts`
  - `tests/lib/subscriptions/upsert-subscription.command.test.ts`
  - `tests/lib/subscriptions/update-subscription-status.command.test.ts`

**What to build:**
- `UpsertSubscriptionCommand.execute({ stripeSubscriptionId, userId, status })`:
  - `INSERT INTO subscriptions ... ON CONFLICT (stripe_subscription_id) DO NOTHING`
  - Stores only `stripe_subscription_id`, `user_id`, `status` (AC 6.4)
  - Returns `{ subscription, created: boolean }`
- `UpdateSubscriptionStatusCommand.execute({ stripeSubscriptionId, status })`:
  - Looks up subscription by `stripe_subscription_id`
  - Throws `SubscriptionError` if not found (AC 7.5)
  - Updates `status` + `updated_at`
- `GetSubscriptionByStripeIdQuery.run({ stripeSubscriptionId })`: returns `Subscription | null`
- Integration tests cover all ACs 6.2, 6.3, 6.4, 7.1, 7.2, 7.4, 7.5

---

## Wave 7

### task-11: WebhookRouter + OrderWebhookHandler
Story: Story 2 AC2/AC3/AC5, Story 3, Story 4, Story 5, Story 8 AC1/AC2  
Wave: 7  
Depends-on: [task-6, task-8, task-9]  
Files:
  - `lib/webhooks/webhook-handler.types.ts`
  - `lib/webhooks/webhook-router.ts`
  - `lib/webhooks/handlers/order-webhook.handler.ts`
  - `tests/lib/webhooks/webhook-router.test.ts`
  - `tests/lib/webhooks/handlers/order-webhook.handler.test.ts`

**What to build:**
- `WebhookHandler` interface in `webhook-handler.types.ts`:
  ```ts
  interface WebhookHandler {
    handle(event: ParsedStripeEvent, pingId: number): Promise<void>;
  }
  ```
- `WebhookRouter`:
  - Constructor takes `Map<string, WebhookHandler>` and `Logger`
  - `dispatch(event, pingId)`: looks up handler by `event.type`, calls `handle()`, logs warn + returns if unknown type
- `OrderWebhookHandler` (implements `WebhookHandler`):
  - `handle()` orchestrates: `FulfillOrderCommand` → `UpdatePingStatus(fulfilled)` → `SendFulfillmentEmailCommand` → `UpdatePingStatus(closed)`
  - Outer `try/catch`: on error → `UpdatePingStatus(error)` + `Logger.error()` + rethrow
  - Checks `SavePingCommand` result: if `shouldSkip = true`, returns immediately (AC 2.5)
  - Constructor injects: `FulfillOrderCommand`, `SendFulfillmentEmailCommand`, `UpdatePingStatusCommand`, `Logger`
- Tests: all ping transitions (AC 2.2, 2.3, 2.5), error rethrow (AC 8.1, 8.2), router dispatch (ADR-001), unknown event type warning

---

## Wave 8

### task-12: Subscription Webhook Handlers
Story: Story 6 (all ACs), Story 7 (all ACs)  
Wave: 8  
Depends-on: [task-10, task-11]  
Files:
  - `lib/webhooks/handlers/subscription-payment.handler.ts`
  - `lib/webhooks/handlers/subscription-change.handler.ts`
  - `tests/lib/webhooks/handlers/subscription-payment.handler.test.ts`
  - `tests/lib/webhooks/handlers/subscription-change.handler.test.ts`

**What to build:**
- `SubscriptionPaymentHandler` (implements `WebhookHandler`):
  - Routes on `billing_reason`:
    - `subscription_create`: `UpsertUserCommand` → `UpsertSubscriptionCommand`
    - `subscription_cycle`: `UpdateSubscriptionStatusCommand(active)`
  - `UpdatePingStatus(fulfilled)` → `UpdatePingStatus(closed)`
  - Outer catch: `UpdatePingStatus(error)` + log + rethrow
- `SubscriptionChangeHandler` (implements `WebhookHandler`):
  - `customer.subscription.deleted` → `UpdateSubscriptionStatusCommand(canceled)`
  - `customer.subscription.updated` → `UpdateSubscriptionStatusCommand(newStatus)`
  - `UpdatePingStatus(fulfilled)` → `UpdatePingStatus(closed)`
  - `UpdateSubscriptionStatusCommand` throws `SubscriptionError` if sub not found → caught, logged, non-2xx (AC 7.5)
- Integration tests using real in-memory SQLite + fakes for all ACs

---

## Wave 9

### task-13: Route Handler + Composition Root
Story: Story 1 (all ACs), Story 2 AC1, Story 8 AC3/AC4  
Wave: 9  
Depends-on: [task-11, task-12]  
Files:
  - `src/routes/webhook.ts`
  - `lib/composition-root.ts`
  - `src/index.ts` *(finalize)*
  - `tests/routes/webhook.test.ts`

**What to build:**
- `src/routes/webhook.ts`:
  - `handleWebhook(request, env)`: thin handler
  - Gets raw body as string (not parsed)
  - Calls `StripeVerifierAdapter.verify(body, sig, secret)` → returns 400 on `StripeVerificationError` (AC 1.2)
  - Calls `SavePingCommand.execute()` **before** `try` block (ADR-003)
  - `try { WebhookRouter.dispatch(event, pingId) } catch { UpdatePingStatus(error); logger.error(...); throw }`
  - Returns `new Response('ok', { status: 200 })`
- `lib/composition-root.ts`:
  - Single function `createCompositionRoot(env: Env): { webhookHandler }` 
  - Wires all concrete adapters and commands; returns only the surface needed by routes
  - This is the **only** file that instantiates concrete adapter classes
- `src/index.ts`: `export default { fetch(req, env) { return handleWebhook(req, env) } }`
- Tests: valid sig continues (AC 1.1, 1.3), invalid sig → 400 (AC 1.2), outer catch logs + rethrows (AC 8.1, 8.3), ping-before-try-catch (AC 8.2)

---

## Summary

| Wave | Tasks | Parallelism |
|------|-------|------------|
| 1 | task-1 | — |
| 2 | task-2, task-3 | ✅ parallel |
| 3 | task-4, task-5 | ✅ parallel |
| 4 | task-6 | — |
| 5 | task-7, task-8 | ✅ parallel |
| 6 | task-9, task-10 | ✅ parallel |
| 7 | task-11 | — |
| 8 | task-12 | — |
| 9 | task-13 | — |

**Total: 13 tasks, 9 waves.**
