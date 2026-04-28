# 📋 User Stories — sprint/stripe-webhook-1

Full scope: Stripe webhook receiver covering order fulfillment, re-fulfillment (idempotency), subscription lifecycle, and error handling.

---

### Story 1: Stripe Webhook Signature Verification

As a **system**, I want to verify every incoming Stripe webhook signature before processing, so that only legitimate Stripe payloads are acted upon.

**Acceptance Criteria:**
1. Given an incoming POST to the webhook endpoint with a valid `Stripe-Signature` header, when the signature is verified using the Stripe secret, then processing continues normally.
2. Given an incoming POST with a missing or invalid `Stripe-Signature` header, when the signature check fails, then the endpoint returns HTTP 400 and no further processing occurs.
3. Given a valid signature, when verification succeeds, then the raw request body is passed downstream unchanged (not re-serialized).

**Out of scope:**
- IP allowlisting of Stripe IP ranges.
- Replay-window configuration (Stripe's default 5-minute tolerance is used as-is).
- Any authentication mechanism other than Stripe webhook signature.

---

### Story 2: Ping Recording

As a **system**, I want to save the raw Stripe webhook payload as a Ping immediately upon receipt, so that every incoming event is traceable regardless of what happens downstream.

**Acceptance Criteria:**
1. Given a verified Stripe webhook event, when the request is accepted, then a Ping record is saved to the database with `status = received` **before** any order or subscription processing begins.
2. Given a Ping is saved, when processing completes successfully, then the Ping `status` is updated to `fulfilled`, and later to `closed`.
3. Given a Ping is saved, when any downstream step throws an error, then the Ping `status` is updated to `error`.
4. Given a Stripe event id, when the Ping is saved, then the Ping stores the raw JSON payload and the Stripe event id for traceability.
5. Given a duplicate Stripe event id arrives, when the Ping is looked up, then an existing Ping with `status = closed` or `status = fulfilled` is found and the duplicate is skipped without reprocessing.

**Out of scope:**
- Storing Pings for events the system does not handle (e.g., `payment_intent.created` — only the events that drive fulfillment or subscription logic are in scope).
- Ping archival or purging policies.

---

### Story 3: Order Fulfillment Transaction

As a **customer (User)**, I want my Order, Authorization, FulfillmentOrder, and User records created atomically when I purchase an Offer, so that my purchase is never half-recorded in the database.

**Acceptance Criteria:**
1. Given a verified `checkout.session.completed` Stripe event for an Offer purchase, when fulfillment runs, then an `Order` record is created with `number = BIGZ-{last 8 digits of Stripe checkout id}`, matching the schema in `reference/order.json`.
2. Given the Order is ready, when fulfillment runs, then an `Authorization` record is created linking the Order to the User, matching the schema in `reference/authorization.json`.
3. Given the Order is ready, when fulfillment runs, then a `FulfillmentOrder` record is created with any downloadable items from the Offer, matching the schema in `reference/fulfillment.json`.
4. Given the Order is ready, when fulfillment runs, then a `User` record is created (or upserted) with `name`, `email`, and `stripe_customer_id`.
5. Given all four records are prepared, when the database write executes, then `Order`, `Authorization`, `FulfillmentOrder`, and `User` are persisted inside **a single database transaction** — if any write fails, all are rolled back.
6. Given the transaction commits, when the Ping status is updated, then it transitions to `fulfilled`.
7. Given fulfillment runs, when the Order number is logged, then the order number (`BIGZ-XXXXXXXX`) appears in the console log line before any database writes occur.

**Out of scope:**
- Sending the fulfillment email (covered in Story 4).
- Generating download links (covered in Story 4).
- Re-fulfillment of an already-existing Order (covered in Story 5).

---

### Story 4: Download Link Generation and Fulfillment Email

As a **customer (User)**, I want to receive an email with expiring download links immediately after my Order is fulfilled, so that I can access what I purchased.

**Acceptance Criteria:**
1. Given a fulfilled Order whose Offer contains downloadable items, when the email step runs, then a Firebase Storage signed URL is generated for each download file with a **2-hour TTL**.
2. Given signed URLs are generated, when the email is assembled, then the URLs are included in the email body using the `reference/new_order_email.html` template — the signed URLs are **not** persisted to the database.
3. Given the email is assembled, when it is sent, then it is dispatched via Resend from `rob@bigmachine.io` to the User's email address.
4. Given the email is sent successfully, when the Ping status is updated, then it transitions from `fulfilled` to `closed`.
5. Given an Offer with **no** downloadable items, when the email step runs, then the email is still sent (without download links) and the Ping transitions to `closed`.

**Out of scope:**
- Storing generated signed URLs in the database.
- Sending a receipt or separate confirmation email.
- Email open/click tracking.
- Retry logic for failed email sends (error handling is covered by Story 8).

---

### Story 5: Order Re-fulfillment (Idempotency)

As a **system**, I want duplicate or repeated Order webhooks to be handled gracefully via upsert, so that the pipeline is fully idempotent and re-processing a webhook never corrupts data.

**Acceptance Criteria:**
1. Given a `checkout.session.completed` event whose Stripe checkout id maps to an Order that already exists, when fulfillment runs, then the existing `Order` record is updated in place (upsert) rather than creating a duplicate.
2. Given the Order already exists, when re-fulfillment runs, then the **existing** `Authorization` records for that Order are **deleted** and rebuilt.
3. Given the Order already exists, when re-fulfillment runs, then the **existing** `FulfillmentOrder` records for that Order are **deleted** and rebuilt.
4. Given a User record already exists with the same email, when fulfillment runs, then the User record is upserted (email is the conflict key).
5. Given all of the above, when the re-fulfillment transaction commits, then the pipeline continues to Story 4 (email + download links) as normal.

**Out of scope:**
- Detecting whether the Offer changed between the original and duplicate event.
- Notifying the customer that re-fulfillment occurred.
- Diffing old vs. new record fields before deciding to upsert.

---

### Story 6: Subscription Payment Fulfillment

As a **subscriber (User)**, I want my account and subscription created or updated when a subscription payment succeeds, so that I am granted access without any manual intervention.

**Acceptance Criteria:**
1. Given a `invoice.payment_succeeded` Stripe event where `billing_reason = subscription_create`, when the handler runs, then a `User` record is created (or upserted on email conflict) storing `email` and `stripe_customer_id`.
2. Given a `User` exists or was just created, when the handler runs, then a `Subscription` record is created linking to the User if none exists yet for that Stripe subscription id.
3. Given a `Subscription` already exists for that Stripe subscription id, when a subsequent payment succeeds, then no duplicate `Subscription` record is created (idempotent).
4. Given the Stripe API is the source of truth for subscription state, when the `Subscription` record is saved locally, then only fields required for access authorization are stored (subscription id, status, and user_id) — no billing details are stored locally.

**Out of scope:**
- Sending a welcome email for new subscribers.
- Granting course-level access (authorization scope is out of scope for this sprint).
- Handling failed subscription payments (`invoice.payment_failed`).

---

### Story 7: Subscription State Changes

As a **system**, I want subscription cancellations, updates, and renewals reflected in the local `Subscription` record, so that access decisions downstream are always based on current state.

**Acceptance Criteria:**
1. Given a `customer.subscription.deleted` Stripe event, when the handler runs, then the local `Subscription` record's `status` is updated to `canceled`.
2. Given a `customer.subscription.updated` Stripe event, when the handler runs, then the local `Subscription` record's `status` is updated to match the new Stripe status.
3. Given a `invoice.payment_succeeded` Stripe event where `billing_reason = subscription_cycle` (renewal), when the handler runs, then the local `Subscription` record's `status` is confirmed/updated to `active`.
4. Given any subscription state-change event, when the handler runs, then the `User` record is **not** deleted or duplicated — only the `Subscription` is mutated.
5. Given a `customer.subscription.updated` or `customer.subscription.deleted` event for a subscription id that does not exist locally, when the handler runs, then the error is logged and a non-2xx response is returned (no silent failure).

**Out of scope:**
- Pausing subscriptions (not a Stripe-native concept in use here).
- Prorating or refunding on subscription change.
- Notifying the User of state changes via email.

---

### Story 8: Error Handling and Ping Status Lifecycle

As a **system operator**, I want all errors surfaced immediately and the Ping status reliably set to `error` on failure, so that no failure is silent and every broken webhook is traceable.

**Acceptance Criteria:**
1. Given any unhandled error thrown during order or subscription processing, when the outer `try`/`catch` catches it, then `console.error` is called with the error details **and** the error is re-thrown so Cloudflare's log infrastructure captures it.
2. Given a Ping has been saved (`status = received`), when any subsequent step throws, then the Ping `status` is updated to `error` before re-throwing.
3. Given the Ping save itself fails (e.g., DB unavailable), when the write throws, then the error is logged via `console.error` and re-thrown — no silent swallow.
4. Given an inner `try`/`catch` anywhere in the pipeline, when it catches an error, then it must **not** suppress the error — it either re-throws or does not catch at all.
5. Given a Ping is in `error` status, when the same Stripe event id arrives again, then the system re-processes it rather than skipping (because `error` is not a terminal success state).

**Out of scope:**
- Dead-letter queuing or automatic retry scheduling.
- Alerting or PagerDuty integration.
- Distinguishing transient from permanent errors.

---

## 🆕 Glossary Terms to Flag for Architect

The following terms appear in the spec but are not yet in `/docs/glossary.md`. The Architect must decide whether to add them:

- **`Ping`** ✅ — already in glossary
- **`stripe_customer_id`** — not in glossary; appears on User and Subscription schemas
- **`billing_reason`** — Stripe API field used to distinguish subscription_create vs. subscription_cycle; not in glossary
- **`Correlation ID`** ✅ — already in glossary; confirm it maps to the Stripe event id in this context
