---
name: styleguide-check
description: Shared styleguide + glossary checklist used by Builder (self-audit) and Reviewer (enforcement). Single source of truth so the two agents stay aligned without duplicating rules across skill files.
---

# 📏 Styleguide Check skill

Always load **both**:

1. `/docs/styleguide.md` — the full rulebook.
2. `/docs/glossary.md` — domain vocabulary. Synonym drift is a fail.

## Quick self-audit checklist

Use this as a fast pre-handoff pass. Anything ambiguous → defer to the full styleguide.

### Structure
- [ ] Function ≤ 30 lines
- [ ] File ≤ 200 soft / 400 hard lines
- [ ] Cyclomatic complexity ≤ 10
- [ ] Parameters ≤ 3
- [ ] SRP: one class, one job
- [ ] Hex-lite: routes → `/lib` → `/lib/infra` via ports. No layer-skipping.
- [ ] No service imports a concrete infra module (Drizzle, Resend SDK, Firebase SDK) directly.
- [ ] Commands have one `execute()`, all writes in one transaction.
- [ ] Queries have one `run()`, read-only.

### Naming
- [ ] File names kebab-case with role suffix (e.g. `fulfill-order.command.ts`)
- [ ] Classes PascalCase with role suffix
- [ ] No `I`-prefixed interfaces
- [ ] Booleans: `is/has/can/should`
- [ ] Domain terms match `/docs/glossary.md`

### Comments
- [ ] JSDoc on classes and public methods
- [ ] Inline comments only for decisions / non-obvious branches / workarounds (why, not what)
- [ ] No redundant comments, no commented-out code, no orphan TODOs

### Errors
- [ ] No bare `catch`
- [ ] `catch (err: unknown)` always
- [ ] Custom error classes in `/lib/errors/` extending `DomainError`
- [ ] Structured `console.error` before rethrow
- [ ] `ping` save precedes any try/catch on webhook path

### Logging
- [ ] No `console.log` (only `console.error` for failures)
- [ ] All logs through the `Logger` service
- [ ] Correlation ID threaded
- [ ] No secrets, no raw Stripe payloads logged

### DB
- [ ] Writes only inside Command transactions
- [ ] Queries do not write
- [ ] No raw SQL without ADR
- [ ] D1 parity (no SQLite-only features)
- [ ] Idempotency via DB constraints + upserts

### Boundaries
- [ ] External input zod-validated at the route layer
- [ ] Outgoing vendor payloads zod-validated
- [ ] DB row types come from Drizzle inference

### Patterns
- [ ] No GoF pattern without ADR or Architect design justification
- [ ] No Singleton
- [ ] Inheritance ≤ 1 level
- [ ] Composition preferred over Template Method

### Hygiene
- [ ] No `.only` / `.skip`
- [ ] No debug artifacts
- [ ] Stayed inside declared file ownership (Builder only)
