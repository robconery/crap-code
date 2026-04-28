# 🏭 Big Machine Fulfillment

> A Cloudflare Worker that handles Stripe webhook fulfillment for digital products and subscriptions — built as a demonstration of what thoughtful, AI-assisted development looks like when you actually care about the quality of the code.

## 🎯 What This Is

This project was created as a companion to a video series called **"Crap Code"** — a look at what happens when you treat AI as a collaborator rather than a code generator. The goal: produce something genuinely well-structured, not just *working*.

It's a real production application for [Big Machine](https://bigmachine.io), a one-person shop that sells online courses and books. When someone buys something, Stripe fires a webhook. This worker catches it, validates it, persists the order, grants access, and sends a transactional email — all without writing a line of crap.

## 🏗️ Architecture

The architecture is intentional and opinionated:

| Principle | What it means here |
|---|---|
| **SOLID / SRP** | One class, one job, one reason to change |
| **Command/Query Separation** | Commands own writes (in transactions), Queries own reads |
| **No Repositories** | Direct Drizzle queries inside commands and queries |
| **Idempotent pipeline** | Safe to receive the same webhook twice |
| **No silent failures** | Errors are logged, re-thrown, and surfaced to Cloudflare logs |
| **Behavior-driven tests** | Tests read like user stories, not implementation details |

## 🧱 Stack

- **Runtime**: [Bun](https://bun.sh) (dev/test) + [Cloudflare Workers](https://workers.cloudflare.com) (production)
- **Database**: SQLite locally → [Cloudflare D1](https://developers.cloudflare.com/d1/) in production
- **ORM**: [Drizzle](https://orm.drizzle.team)
- **Payments**: [Stripe](https://stripe.com) (webhooks + subscription management)
- **Email**: [Resend](https://resend.com)
- **File Storage**: [Firebase Storage](https://firebase.google.com/products/storage) (expiring download links)
- **Linting/Formatting**: [Biome](https://biomejs.dev)

## 📂 Project Structure

```
src/
  index.ts           # Cloudflare Worker entry — thin routing only
  routes/            # Route handlers, one per concern

lib/
  contracts/         # Zod schemas and TypeScript types
  orders/            # Order fulfillment command + queries
  subscriptions/     # Subscription lifecycle command + queries
  ping/              # Webhook ping logging
  users/             # User upsert logic
  email/             # Transactional email wrappers
  infra/             # Database setup, Firebase, Stripe clients
  webhooks/          # Stripe signature verification
  errors/            # Typed error hierarchy
  offers/            # Offer/product resolution
  composition-root.ts  # Dependency wiring

tests/
  fakes/             # In-memory test doubles
  fixtures/          # Test data (Stripe payloads, etc.)
  helpers/           # Shared test utilities
  lib/               # Behavior-driven tests mirroring /lib
  routes/            # Route-level integration tests

drizzle/             # Migration files
```

## 🔄 The Fulfillment Flow

### Order (one-time purchase)

```
Stripe webhook received
  → Verify signature
  → Log order number (BIGZ-XXXXXXXX)
  → Save ping (status: received)
  → Upsert User
  → Upsert Order
  → Create Authorization
  → Create FulfillmentOrder
  → Commit transaction
  → Update ping (status: fulfilled)
  → Generate expiring Firebase download links
  → Send confirmation email via Resend
  → Update ping (status: closed)
```

If anything blows up, the `ping` is marked `error` and the exception is re-thrown — Cloudflare logs catch it.

### Subscription (recurring)

- `invoice.payment_succeeded` → upsert user + subscription record
- `customer.subscription.updated/deleted` → update subscription record
- Stripe is the source of truth; only access-control fields are stored locally

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed
- A [Stripe](https://stripe.com) account with webhook signing secret
- A [Cloudflare](https://cloudflare.com) account with D1 enabled
- [Firebase](https://firebase.google.com) project with Storage
- A [Resend](https://resend.com) account

### Local Development

```bash
# Install dependencies
bun install

# Run local migrations (SQLite via wrangler)
bun run db:migrate:local

# Start local dev server
bun run dev

# Run tests
bun test

# Lint + format
bun run lint
bun run format

# Type check
bun run typecheck
```

### Environment Variables

Create a `.dev.vars` file (Cloudflare's local env mechanism):

```ini
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SECRET_KEY=sk_...
FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_STORAGE_BUCKET=...
RESEND_API_KEY=re_...
```

### Deploy

```bash
# Dry run (build check)
bun run deploy:dry

# Deploy to Cloudflare
bun run deploy
```

## 🧪 Testing Philosophy

Tests are written as behavior specs derived from user stories. They use in-memory fakes rather than mocks, so they read clearly and test real logic paths:

```typescript
describe("when a new order arrives", () => {
  it("creates a user, order, authorization, and fulfillment in one transaction", async () => {
    // ...
  });
});
```

No database required to run the suite — fakes stand in for all I/O.

## 📄 License

MIT — see [LICENSE](./LICENSE).

---

> 🎬 This project was built live as part of the **Crap Code** video series. The goal was to show that when you bring genuine software craftsmanship to AI-assisted development, you don't have to choose between speed and quality.
