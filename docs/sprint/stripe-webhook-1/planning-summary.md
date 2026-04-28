# ✋ Planning Summary — stripe-webhook-1

**Awaiting human approval before PM writes spec.md + plan.md and dev begins.**

To approve: reply `yes` or `/sprint:approve-planning`.  
To reject: name the agent(s) and the specific concern — routing goes only to those agents.

---

## 🎯 Sprint Goal

Build a Cloudflare Worker that receives Stripe webhooks, fulfills digital product orders (one-time + subscription), and sends fulfillment emails. Fully idempotent, no silent failures, no crap code.

---

## 📋 Stories & Acceptance Criteria (8 stories, 31 ACs)

| # | Story | ACs |
|---|-------|-----|
| 1 | Stripe Webhook Signature Verification | 3 |
| 2 | Ping Recording | 5 |
| 3 | Order Fulfillment Transaction | 7 |
| 4 | Download Link Generation & Fulfillment Email | 5 |
| 5 | Order Re-fulfillment (Idempotency) | 5 |
| 6 | Subscription Payment Fulfillment | 4 |
| 7 | Subscription State Changes | 5 |
| 8 | Error Handling & Ping Status Lifecycle | 5 |

Full detail: `docs/sprint/stripe-webhook-1/user-stories.md`

---

## 🏛 Architecture Highlights

- **Stack:** Cloudflare Worker + Bun, Drizzle ORM, D1 (SQLite local), Firebase Storage, Resend
- **Layering:** `src/routes/` → `lib/` → `lib/infra/` (hex-lite, 3 layers)
- **7 Commands, 3 Queries** — full CQS, all writes in transactions
- **GoF Strategy pattern** for webhook event routing (ADR-001) — one class per event type, no if/switch
- **GoF Command pattern** — one class per business write, single `execute()` method
- **GoF Adapter pattern** — `EmailSender` and `FileStorage` ports with swappable infra implementations
- **5 DB tables:** `pings`, `users`, `orders`, `authorizations`, `fulfillment_orders`, `subscriptions`
- **Idempotency:** unique constraints on natural keys (`stripe_event_id`, `email`, `stripe_checkout_id`, `stripe_subscription_id`)
- **Ping-first error strategy** (ADR-003) — ping saved before any try/catch; errors update ping→error then rethrow

Full detail: `docs/sprint/stripe-webhook-1/architecture.md`

### ADRs
- `docs/adr/001-strategy-webhook-routing.md`
- `docs/adr/002-downloads-as-json-column.md`
- `docs/adr/003-ping-first-error-strategy.md`

---

## 🧪 Test Stubs (12 files, 39 it.todo stubs)

| File | Covers |
|------|--------|
| `tests/routes/webhook.test.ts` | Story 1 + Story 8 outer boundary |
| `tests/lib/ping/save-ping.command.test.ts` | Story 2 AC1, AC4, AC5 |
| `tests/lib/ping/update-ping-status.command.test.ts` | Story 2 AC2, AC3 |
| `tests/lib/orders/fulfill-order.command.test.ts` | Story 3 + Story 5 (all ACs) |
| `tests/lib/users/upsert-user.command.test.ts` | Story 3 AC4, Story 5 AC4, Story 6 AC1 |
| `tests/lib/email/send-fulfillment-email.command.test.ts` | Story 4 (all ACs) |
| `tests/lib/subscriptions/upsert-subscription.command.test.ts` | Story 6 AC2, AC3, AC4 |
| `tests/lib/subscriptions/update-subscription-status.command.test.ts` | Story 7 (all ACs) |
| `tests/lib/webhooks/webhook-router.test.ts` | Strategy dispatch + unknown events |
| `tests/lib/webhooks/handlers/order-webhook.handler.test.ts` | Story 2 AC2, AC3, AC5 + Story 8 |
| `tests/lib/webhooks/handlers/subscription-payment.handler.test.ts` | Story 6 + Story 7 AC3 |
| `tests/lib/webhooks/handlers/subscription-change.handler.test.ts` | Story 7 AC1, AC2, AC4, AC5 |
| `tests/lib/infra/stripe/stripe-verifier.adapter.test.ts` | Story 1 (all ACs) |

**Fakes:** `FakeEmailSender`, `FakeFileStorage` (in `tests/fakes/`)  
**Fixtures:** 4 Stripe event JSON files (in `tests/fixtures/`)

---

## 🔍 Reviewer Checklist Summary

Enforced per task (full detail in `docs/sprint/stripe-webhook-1/reviewer-checklist.md`):
- Layer violations → hard fail
- No vendor SDK imports outside `lib/infra/`
- `SavePingCommand` before outer try/catch
- Every catch rethrows — no silent swallows
- No `console.log` (Logger only)
- Upserts use `ON CONFLICT` — no read-then-write
- All ACs have a corresponding `it()`
- No `.only` / `.skip`

---

## ❓ Open Questions for You

None — all spec ambiguities were resolved by the Architect. The two glossary gaps (`stripe_customer_id`, `billing_reason`) have been added.

---

**👆 Ready for your approval. Rejections should name the specific agent and concern.**
