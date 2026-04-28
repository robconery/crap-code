# 📐 Code Policies & Styleguide

The rules below are **enforceable**. Reviewer applies them per-task; Biome and `tsc` enforce what they can at the verification gate.

The single goal: **NO CRAP CODE**.

---

## 🧰 Tooling Baseline

- **Runtime**: Bun.
- **Platform**: Cloudflare Worker (free tier).
- **Language**: TypeScript, `strict: true` plus:
  - `noUncheckedIndexedAccess`
  - `noImplicitOverride`
  - `exactOptionalPropertyTypes`
- **Linter/Formatter**: **Biome**. One tool, no bikeshedding.
- **Modules**: ESM only. No `require`.
- **Imports**: absolute via `tsconfig` paths — `@/lib/...`, `@/tests/...`. No deep relative chains.

---

## 📏 Size & Complexity Limits

| Rule                    | Limit                   | Enforced by        |
|-------------------------|-------------------------|--------------------|
| Function length         | ~30 lines               | Reviewer           |
| File length (soft)      | ~200 lines              | Reviewer           |
| File length (hard)      | ~400 lines → must split | Reviewer           |
| Cyclomatic complexity   | ≤ 10 per function       | Biome              |
| Function parameters     | ≤ 3 (else options obj)  | Biome + Reviewer   |

Over-limit code requires an inline justification comment **and** a Reviewer decision, otherwise → fail.

---

## 🏛 Architecture

**Hex-lite, three layers:**

```
/src/routes/     ← Cloudflare Worker handlers. Thin: parse, verify, dispatch.
/lib/            ← Services. Commands, Queries, domain logic. All business logic lives here.
/lib/infra/      ← Adapters. Drizzle, Resend, Firebase, Stripe SDK. Swappable behind interfaces (ports).
```

**Rules:**
- `routes` may only call `/lib`.
- `/lib` may only call `/lib/infra` **via interfaces**, never concrete modules.
- Skipping a layer → Reviewer fail.
- No `/lib` service may import from a vendor SDK directly. Direct imports live only in `/lib/infra`.

**Command/Query Separation (CQS):**
- **Commands** — one class, single public method `execute(input)`. One Command = one business operation. All writes inside exactly one transaction.
- **Queries** — one class, single public method `run(input)`. Reads only. **Never** side-effect, not even `updated_at` touches.
- If a read needs a side-effect, promote it to a Command.

**Dependency Injection:**
- Constructor injection only.
- Hand-wired in a single `composition-root.ts`. No DI framework.

---

## ❗ Error Handling

1. **No bare `catch`.** Every `catch` must either rethrow or wrap-and-rethrow with context:
   ```ts
   throw new FulfillmentError('failed to persist order', { cause: err });
   ```
2. **Custom error classes** live in `/lib/errors/`, all extend a base `DomainError`.
   Examples: `StripeVerificationError`, `FulfillmentError`, `EmailSendError`.
3. **`catch (err: unknown)` always.** Narrow the type before use. No `catch (err: any)`.
4. **Log before rethrow.** Structured `console.error` with context (order id, ping id, stage, correlation id).
5. **Result types for expected failures.** Throw for exceptional. Return typed results (`{ ok: true, ... } | { ok: false, reason: ... }`) for expected branches like "order already fulfilled".
6. **SPEC-specific:** the `ping` save must precede any `try`/`catch` so the error path can set `ping.status = 'error'`. Errors are rethrown after handling so Cloudflare captures them.

---

## 🪵 Logging

- **Single `Logger`** in `/lib/infra/logger.ts`. Structured JSON: `{ ts, level, event, context, correlationId }`.
- **Correlation ID** generated at route entry (or pulled from Stripe event id), threaded through every service constructor.
- **Levels**: `debug` / `info` / `warn` / `error`. No `console.log` anywhere → Reviewer fail.
- **Minimum events to log**:
  - Route entry/exit
  - Every Command: start, commit, rollback
  - Every external call (Stripe verify, Resend send, Firebase signed URL) with duration
  - Every caught error (before rethrow)
- **Never log**: secrets, full Stripe payloads, PII beyond what is required (event id, type, customer id are fine; full card/email body is not). Raw webhook body already lives in the `ping` row.

---

## 🧪 Testing (BDD)

- Tests live in `/tests/` and **mirror `/lib/`** structure: `/tests/lib/orders/fulfill-order.command.test.ts` ↔ `/lib/orders/fulfill-order.command.ts`.
- **BDD naming**:
  ```
  describe('FulfillOrderCommand')
    describe('when a new paid order arrives')
      it('creates order, authorization, fulfillment, and user in one transaction')
  ```
  Each `it` maps to one acceptance criterion.
- **Test types:**
  - **Unit** — service classes with fakes for infra. The majority.
  - **Integration** — Command + real in-memory SQLite + fake external adapters. **Required for every Command.**
  - **No E2E** against real Stripe/Resend/Firebase. Use recorded fixtures in `/tests/fixtures/`.
- **Fakes over mocks.** Hand-written fakes in `/tests/fakes/` (`FakeResend`, `FakeFirebaseStorage`). `vi.mock`-style patterns → Reviewer fail.
- **Coverage:** no hard % gate. Reviewer confirms every AC has a corresponding `it`.
- **Happy + sad path required per Command.**

---

## 💬 Comments & Documentation

- **Every class** has a JSDoc block: one-line purpose + why it exists + non-obvious collaborators.
- **Every public method** has JSDoc: purpose, and (only if non-obvious) why it is designed this way, edge cases, invariants.
- **Private methods**: comment only when the logic is non-obvious. Do **not** comment `getUser()` to say "returns the user".
- **Inline comments** are reserved for:
  - Decisions: `// using upsert here because SPEC requires re-run idempotency`
  - Non-obvious branches
  - Workarounds: `// Stripe sends X when Y — see ADR-004`
- **Banned:**
  - Redundant comments (`// increment i`)
  - Commented-out code (delete it — git remembers)
  - TODOs without an owner/ticket/ADR reference
- **Variables are not commented** unless there is a solid reason.
- **ADRs**: any decision affecting multiple files or future sprints goes in `/docs/adr/NNN-title.md`. Architect authors them during planning. One page: context / decision / consequences.

---

## 🏷 Naming Conventions

- **Files**: `kebab-case.ts`. Role suffixes:
  `.command.ts`, `.query.ts`, `.service.ts`, `.adapter.ts`, `.errors.ts`, `.types.ts`. Tests: `.test.ts`.
- **Classes**: `PascalCase` with role suffix — `FulfillOrderCommand`, `GetOrderQuery`, `ResendEmailAdapter`.
- **Interfaces/Ports**: **no `I` prefix.** Name the role — `EmailSender`, `FileStorage`. Implementations get the concrete suffix — `ResendEmailSender`, `FirebaseFileStorage`.
- **Functions/methods**: `camelCase` verbs — `fulfillOrder`, not `orderFulfillment`.
- **Booleans**: `is` / `has` / `can` / `should` prefix.
- **Constants**: `SCREAMING_SNAKE_CASE` only for true compile-time constants. Config values are `camelCase`.
- **Abbreviations banned** except universally known: `id`, `url`, `db`, and `ctx` (request context only). `usr`, `ord`, etc. → fail.
- **Domain vocabulary** must match `/docs/glossary.md`. No synonym drift. New terms require Architect to extend the glossary in the sprint.

---

## 🧱 SOLID & GoF

- **SRP** is the north star — enforced by size limits, CQS, and one-public-method-per-Command/Query.
- **OCP / LSP / ISP / DIP** are enforced implicitly by hex-lite: services depend on ports, infra implements them.
  Reviewer check: *"Does any service class directly import a concrete infra module (Drizzle, Resend SDK, Firebase SDK)?"* → fail.
- **GoF patterns are opt-in, never speculative.** No pattern without a named reason in an ADR or the sprint Architect design.
- **Pre-blessed patterns** for this codebase:
  - **Command** — already baked in.
  - **Adapter** — all infra ports.
  - **Strategy** — e.g., offer fulfillment (course access vs. downloadables).
- **Discouraged**: Template Method. Prefer composition.
- **Banned**: Singleton. The composition root wires one instance — that is enough.
- **Inheritance**: capped at one level. Prefer composition.

---

## 🗄 Database & Transactions

1. **All writes inside Commands. All Commands open exactly one transaction** wrapping every write. Writes outside a transaction → fail.
2. **Queries never write.** Not even `last_seen_at`.
3. **Schema** lives in `/lib/infra/db/schema/`, one file per table.
4. **Drizzle migrations** are committed as generated. Never hand-edit after generation.
5. **No raw SQL** unless a Drizzle limitation forces it — requires an ADR.
6. **D1 parity**: no SQLite-only features that D1 does not support. Reviewer check.
7. **Idempotency at the DB level**: unique constraints on natural keys (`stripe_event_id` on `ping`, `stripe_customer_id` on `user`, order number on `order`). Upserts use `ON CONFLICT`.

---

## 🔐 Secrets & Config

1. **Single `Config` service** at `/lib/infra/config.ts`. Reads all env/bindings at boot, validates with **zod**, exposes a typed `AppConfig`. Services receive only what they need via constructor.
2. **Secrets**: Wrangler secrets in prod, `.dev.vars` locally. Never committed. Any secret string literal in code → Security fail.
3. **Fail fast**: config validation failure at boot throws immediately. No half-booted Worker.
4. **Typed bindings**: D1 and any KV/vars declared in wrangler-generated `worker-configuration.d.ts`, consumed only by `Config`.

---

## 🚧 Boundary Validation

1. **Every external input** (Stripe webhook body, any request body/query/header we read) is parsed through a **zod schema** at the route layer before entering `/lib`. `/lib` only sees validated, typed domain inputs.
2. **Schemas** live in `/lib/contracts/`, one file per external surface (`stripe-webhook.schema.ts`). Inferred types (`z.infer<...>`) are canonical for that surface.
3. **Outgoing calls** (Resend payload, Firebase signed URL request) are zod-validated on the way out so vendor contract drift fails loudly in tests.
4. **DB row types** come from Drizzle's inferred types. Hand-written duplicate types → Reviewer fail.

---

## 🧹 Git Hygiene (Code Level)

- **No WIP/debug artifacts in commits**: no `console.log`, no `.only` / `.skip` on tests, no commented-out code, no untracked `TODO`s (TODO must reference an ADR or issue).
- **No files > 100KB** without ADR justification. Fixtures are minimized.
- **`.gitignore`**: `.dev.vars`, `.wrangler/`, `node_modules/`, `*.sqlite`, local `*.log`.
- **Sprint logs ARE committed** under `/docs/sprint/{name}/logs/` — they are the audit trail.
- **Generated files committed**: Drizzle migrations ✅, `worker-configuration.d.ts` ✅. Build artifacts (`dist/`) ❌.
