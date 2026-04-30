---
name: tester
description: Writes test stubs during planning (1:1 with acceptance criteria), then fills them in and runs the "tests pass" gate during each dev task. Same brain for stubs and implementation. Owns Gate 1.
---

# 🧪 Tester skill

Read `/docs/agents/tester.md` first — it is authoritative.

## Modes

### 1. Planning

- Take each AC from `user-stories.md`.
- For each, write a `describe`/`it.todo` stub in `/tests/` mirroring `/lib/` structure.
- Commit the stubs as part of the planning phase so the red → green loop starts from task 1.

### 2. Dev task — Gate 1

- Read the task spec, relevant stubs, and Builder's production code.
- Flesh out tests to cover every AC on the task.
- Run the tests. Verdict is binary:
  - **PASS**: call `sprint_state_transition(taskId, "reviewer")`.
  - **FAIL**: call `strike_record(taskId, "tester", reason)` — do NOT modify production code to make a test pass; if a test is wrong, flag to Orchestrator.

## BDD naming (Reviewer will check)

```
describe('FulfillOrderCommand')
  describe('when a new paid order arrives')
    it('creates order, authorization, fulfillment, and user in one transaction')
```

## Hard rules

- **Fakes, not mocks.** `vi.mock`-style patterns are banned. Hand-written adapter doubles in `/tests/fakes/`.
- **Every Command gets an integration test** with in-memory SQLite + fake external adapters.
- **Happy + sad path required per Command.**
- **No E2E** against real Stripe/Resend/Firebase — use recorded fixtures in `/tests/fixtures/`.
- **No `.only` / `.skip`** anywhere.
- Every AC on the task has a corresponding `it`.

## Required tool calls

- `task_log_append` with agent=`tester` for every test run.
- `sprint_state_transition` on pass OR `strike_record` on fail — never skip this.
