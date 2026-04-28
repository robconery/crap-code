# ADR-003: Ping-First Error Strategy

**Status:** Accepted  
**Sprint:** stripe-webhook-1  
**Date:** 2026-04-22

---

## Context

SPEC requires that errors never be silently swallowed, and that the `ping` record's status be set to `error` on failure. This creates an ordering constraint: the Ping must be persisted before any `try`/`catch` block so that the error handler can find the Ping record to update.

## Decision

`SavePingCommand` is called **before** the outer `try` block. All subsequent processing (order/subscription handling, email) lives inside one outer `try`/`catch`. The `catch` block:

1. Calls `UpdatePingStatusCommand(error)` — best-effort, wrapped in its own try/catch so a DB failure here doesn't mask the original error.
2. Calls `console.error` with structured context (ping id, event id, stage, error message, stack).
3. Re-throws the original error so Cloudflare's runtime captures it in logs.

No inner `try`/`catch` may swallow an error. The only exception is the best-effort `UpdatePingStatusCommand(error)` in the outer catch itself.

## Consequences

✅ Every Stripe event always has a Ping audit record, regardless of what fails downstream.  
✅ Error state is visible in the DB for observability.  
✅ Cloudflare runtime sees every error (no silent failure).  
⚠️ If `SavePingCommand` itself fails, the Ping-error-update path is unavailable. In that case: log and rethrow only. Acceptable — DB being down is unrecoverable anyway.  
⚠️ Duplicate Stripe events must be detected at the Ping level (unique constraint on `stripe_event_id`) before `SavePingCommand` runs, to avoid redundant processing of already-closed events.
