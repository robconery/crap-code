# 🔍 Reviewer Checklist — sprint/stripe-webhook-1

All items are **binary: PASS / FAIL**. "Mostly" is a FAIL. Every item applies to every task unless explicitly scoped.

This checklist layers on top of the standing `/docs/styleguide.md`. The styleguide is always in force — items here are sprint-specific additions or emphases.

---

## 🏗 Layering & Architecture

- [ ] `routes/` only imports from `lib/` — never from `lib/infra/` directly.
- [ ] No `lib/` service class imports a vendor SDK (`stripe`, `resend`, `firebase-admin`, `drizzle-orm`) directly. All vendor calls are in `lib/infra/`.
- [ ] Each Command has exactly **one** public method: `execute(input)`.
- [ ] Each Query has exactly **one** public method: `run(input)`.
- [ ] No Query performs any write (not even `updated_at`).
- [ ] Every write is inside a Command's `execute()`, wrapped in exactly one DB transaction.
- [ ] `composition-root.ts` is the **only** place where concrete adapters are instantiated. No `new ResendEmailAdapter()` elsewhere.

---

## 🔐 Error Handling

- [ ] `SavePingCommand` is called **before** the outer `try`/`catch` block in the webhook route handler.
- [ ] The outer `catch` calls `UpdatePingStatusCommand(error)` (best-effort), logs via `Logger.error()`, then **re-throws** the original error.
- [ ] No inner `catch` swallows an error silently. Every catch either re-throws or wraps-and-rethrows.
- [ ] All `catch` clauses use `catch (err: unknown)` — not `catch (err: any)`.
- [ ] Custom error classes (`StripeVerificationError`, `FulfillmentError`, `EmailSendError`, etc.) extend `DomainError`.
- [ ] No bare `throw new Error(...)` — always a domain error class.

---

## 🪵 Logging

- [ ] No `console.log` anywhere. All logging goes through the `Logger` service.
- [ ] Every Command logs: start of execute, transaction commit (or rollback).
- [ ] Every external call (Stripe verify, Resend send, Firebase signed URL) logs with duration.
- [ ] Correlation ID (Stripe event id) is threaded through every log call.
- [ ] No PII in logs beyond: Stripe event id, event type, stripe_customer_id. No email bodies, no card data, no raw webhook payloads in log lines (raw payload lives only in the `ping` DB row).

---

## 🗄 Database

- [ ] Every table has a unique constraint on its **natural key** (`stripe_event_id` on `pings`, `email` on `users`, `stripe_checkout_id` on `orders`, `stripe_subscription_id` on `subscriptions`).
- [ ] Upserts use `ON CONFLICT` — no read-then-write pattern.
- [ ] Re-fulfillment deletes existing `authorizations` and `fulfillment_orders` by `order_id` before inserting new ones — inside the same transaction as the upsert.
- [ ] `downloads` column on `fulfillment_orders` is parsed with a zod schema on every read (per ADR-002).
- [ ] No raw SQL unless an ADR covers it. Drizzle ORM only.
- [ ] No SQLite-only features incompatible with D1 (e.g., `RETURNING` with complex subqueries — check D1 compatibility docs).

---

## 🔀 Webhook Routing (Strategy Pattern — ADR-001)

- [ ] `WebhookRouter` dispatches via `Map<string, WebhookHandler>` — no `if/switch` on event type inside the router's dispatch method.
- [ ] Unknown/unhandled event types log a `warn` and return without error (Stripe must always receive 200 for events we don't handle, to avoid retries flooding the endpoint).
- [ ] Each handler class implements the `WebhookHandler` interface.

---

## ✅ Idempotency

- [ ] Duplicate `stripe_event_id`: a Ping with `status = closed` or `status = fulfilled` causes the handler to return 200 immediately without reprocessing.
- [ ] A Ping with `status = error` is **re-processed** (not skipped).
- [ ] `FulfillOrderCommand` uses upserts for Order and User, and delete+rebuild for Authorization and FulfillmentOrder — no duplicate rows created on re-run.

---

## 📦 Zod Validation

- [ ] The raw Stripe webhook body is parsed through `stripe-webhook.schema.ts` **before** any field access in `lib/`.
- [ ] `AppConfig` validates all environment bindings with zod at boot. Missing required vars throw immediately.
- [ ] Outgoing adapter payloads (Resend email body, Firebase signed URL request) are validated before sending.

---

## 🧪 Tests

- [ ] Every Acceptance Criterion in `user-stories.md` has a corresponding `it()` in the test suite.
- [ ] Integration tests for every Command use real in-memory SQLite (via Bun's SQLite driver or Drizzle test setup), not a DB mock.
- [ ] External adapters (`EmailSender`, `FileStorage`) are replaced by fakes from `/tests/fakes/` — no `vi.mock()` style patching.
- [ ] Both happy path and at least one sad path (error case) covered per Command.
- [ ] No `.only` or `.skip` in committed tests.

---

## 💬 Comments & Naming

- [ ] Every class has a JSDoc block: one-line purpose + why it exists.
- [ ] Every public method has JSDoc if its behaviour is non-obvious.
- [ ] No redundant comments (`// save the ping`, `// return 200`).
- [ ] No commented-out code.
- [ ] No TODOs without an ADR or issue reference.
- [ ] File names match the pattern: `kebab-case.{command|query|adapter|port|handler|errors|types|schema}.ts`.
- [ ] Class names use role suffix: `FulfillOrderCommand`, `GetOrderByCheckoutIdQuery`, `ResendEmailAdapter`, `EmailSender` (port).
- [ ] No banned synonyms from `/docs/glossary.md` (no `Product`, `Customer`, `Repository`, `Delivery`, etc.).

---

## 🔐 Secrets

- [ ] No string literals containing API keys, secrets, or tokens anywhere in source.
- [ ] All secrets consumed only via `AppConfig`. No `process.env` / `env.STRIPE_KEY` access outside `config.ts`.

---

## 📏 Size & Complexity

- [ ] No function exceeds ~30 lines without inline justification comment.
- [ ] No file exceeds ~200 lines (soft) / ~400 lines (hard fail without Reviewer decision).
- [ ] No function has more than 3 parameters (use options object if needed).
