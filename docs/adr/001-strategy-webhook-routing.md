# ADR-001: Strategy Pattern for Webhook Event Routing

**Status:** Accepted  
**Sprint:** stripe-webhook-1  
**Date:** 2026-04-22

---

## Context

The `/webhook` endpoint receives multiple distinct Stripe event types (`checkout.session.completed`, `invoice.payment_succeeded`, `customer.subscription.deleted`, `customer.subscription.updated`). Each requires a completely different processing path involving different Commands and domain logic.

The naive implementation is a growing `if/else` or `switch` block inside the route handler. This violates OCP (every new event type modifies existing code) and SRP (the handler owns too many concerns).

## Decision

Use the **GoF Strategy pattern**. Each event type maps to a named handler class implementing a shared `WebhookHandler` interface:

```ts
interface WebhookHandler {
  handle(event: StripeEvent, pingId: number): Promise<void>;
}
```

A `WebhookRouter` class holds a `Map<string, WebhookHandler>` wired at composition-root time. The route handler calls `router.dispatch(event)` — it has no knowledge of individual strategies.

## Consequences

✅ Adding a new event type = adding a new class. `WebhookRouter` never changes.  
✅ Each handler is independently testable.  
✅ OCP satisfied — open for extension, closed for modification.  
⚠️ Unrecognised event types must be handled explicitly (log + return 200 to Stripe — do not error on unknown events).
