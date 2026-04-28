# 📖 Glossary

The canonical vocabulary of this codebase. Names in code, tests, docs, and commits **must** use these terms. No synonym drift.

New terms require the Architect to extend this glossary during sprint planning.

---

## 🏷 Domain Terms

### Ping
The raw record of an incoming webhook payload from Stripe. Saved **first**, before any processing, so any downstream error can be traced back to the original input. Status transitions: `received` → `fulfilled` → `closed`, or → `error`.

### Order
A single purchase. One order = one `Offer` with either course access or downloadable items. Order numbers are `BIGZ-{last-8-of-stripe-order-id}`.

### Offer
The thing being sold. Not a "product" — we sell **offers**. An offer bundles either course access or downloadable items (or both, depending on the offer definition).

### Authorization
A record granting a `User` access to course content purchased via an `Order`. Rebuilt on order re-fulfillment.

### Fulfillment (or FulfillmentOrder)
A record tracking delivery of an `Order`'s downloadable items. Rebuilt on order re-fulfillment.

### User
A customer. Identified by email and `stripe_customer_id`. Upserted on conflict.

### Subscription
A recurring Stripe subscription. Only the minimal fields required for authorizing `User` access are stored locally — the Stripe API remains the source of truth for subscription state.

### stripe_customer_id
The Stripe-assigned customer identifier stored on the `User` record. Used to correlate `Subscription` records back to a `User`. Email is the conflict/upsert key; `stripe_customer_id` is supplemental identity data.

### billing_reason
A field on Stripe's `Invoice` object that indicates why the invoice was generated. Values used in this codebase: `subscription_create` (first payment for a new subscription) and `subscription_cycle` (renewal). Used by `SubscriptionPaymentHandler` to route logic correctly.

---

## 🧱 Architectural Terms

### Command
A class encapsulating one business write operation. Exactly one public method, `execute(input)`. All writes inside exactly one database transaction.

### Query
A class encapsulating one business read. Exactly one public method, `run(input)`. Reads only — never writes.

### Port
An interface in `/lib/` describing a capability the domain needs (e.g., `EmailSender`, `FileStorage`). Services depend on ports, never on concrete vendors.

### Adapter
An implementation of a port in `/lib/infra/` that talks to a real vendor (`ResendEmailSender`, `FirebaseFileStorage`).

### Composition Root
`composition-root.ts` — the single location where concrete adapters are wired into services. No DI framework.

### Correlation ID
A unique identifier generated at route entry (or taken from the Stripe event id) and threaded through every log line for a request.

---

## 🚫 Banned Synonyms

Do not use the following — use the canonical term on the right.

| Banned                        | Use instead       |
|-------------------------------|-------------------|
| Purchase, Transaction (ours)  | Order             |
| Product                       | Offer             |
| Entitlement, Grant            | Authorization     |
| Delivery, Shipment            | Fulfillment       |
| Customer (in code)            | User              |
| Repository                    | (banned entirely — we use Commands/Queries) |
| Service (generic suffix)      | Use role suffix: Command / Query / Adapter |
