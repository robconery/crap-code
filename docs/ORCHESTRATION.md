# 🎯 Our Process

An AI-tweaked version of Scrum. The single goal of this process is **NO CRAP CODE**.

All sprint artifacts live in `/docs/sprint/{sprint-name}/` unless stated otherwise.
All logs are `.log` format (timestamped), committed to the repo — they are the audit trail.

Deterministic steps are marked with `*`. These are **NEVER** performed by an agent — only by tooling.

---

## 👥 The Agent Team

Eight agents. Full definitions in `/docs/agents/`.

| Agent             | Phase           | Owns Gate                        |
|-------------------|-----------------|----------------------------------|
| 🧭 Orchestrator    | Planning + Dev  | — (runs the gate sequence)       |
| 📋 Product Owner   | Planning        | —                                |
| 🏛 Architect       | Planning + Final| Final architectural review       |
| 📐 PM              | Planning + Close| —                                |
| 🧪 Tester          | Planning + Dev  | Tests pass                       |
| 🔨 Builder         | Dev             | —                                |
| 🔍 Reviewer        | Dev             | Code review                      |
| 🛡 Security        | Dev             | Security review                  |

---

## 🗂 Sprint Directory Layout

```
/docs/sprint/{sprint-name}/
  planning-summary.md       # Consolidated human-approval artifact
  user-stories.md           # PO output
  architecture.md           # Architect output (sprint-level)
  reviewer-checklist.md     # Architect output
  spec.md                   # PM consolidated spec
  plan.md                   # PM task + wave plan
  sprint-state.json         # Tooling-managed state machine
  sprint.log                # Orchestrator narrative
  logs/
    {task-id}-{agent}-{attempt}.log  # One log per agent invocation per task
```

---

## 🌱 Branching

- Sprint branch `sprint/{sprint-name}` is created by tooling at the **start of planning**.
- ALL sprint artifacts and code commits live on the sprint branch.
- At sprint close (after human approval), a **merge commit** (no squash) brings history back to `main`. Per-task audit trail is preserved.
- No PR gate for now — local merge after human approval.

---

## 📝 Commit Policy

- **One commit per task**, authored by tooling after all gates pass.
- Builder drafts the message; Orchestrator finalizes it.
- Format:

```
[sprint/{name}] task-{id}: {short title}

{user story ref}
Builder: ✅  Tester: ✅  Reviewer: ✅  Security: ✅  Verify: ✅
```

- Post-final-review polish fixes are **new tasks** through the full gate loop, prefixed `polish-{n}:`.

---

## 🧭 Planning Phase

Interactive. Orchestrator drives a Q&A with the human and routes outputs between agents.

```
Human idea
  → 🧭 Orchestrator interview (sprint goals, sprint name, verification steps)
  → 📋 Product Owner (user stories + acceptance criteria + gates)
  → 🏛 Architect (sprint architecture + reviewer checklist + ADRs if needed)
  → 🧪 Tester (writes test stubs — describe/it.todo tied 1:1 to AC, committed to /tests/)
  → ✋ Human approval (single consolidated approval via planning-summary.md)
  → 📐 PM (writes spec.md)
  → 📐 PM (plans tasks, groups into waves, writes plan.md)
```

**Verification steps** defined by the Orchestrator include (bare minimum):
1. `bun install` clean
2. `bun run build` (or `wrangler deploy --dry-run`)
3. `bun test` (all green)
4. Biome lint
5. `tsc --noEmit` typecheck

Any verification failure hard-fails the task → Builder retry → counts toward the 4-strike counter.

**Human approval**: single consolidated sign-off on `planning-summary.md` (goals, stories/AC, architecture, test stubs list). Rejection routes feedback to the specific agent(s) named in the comments — not a full restart.

---

## 🔨 Development Phase

Non-interactive loop. NEVER stop task runs for any reason, aside from full block as described below. 

PM groups tasks into sequential **waves**; all tasks in a wave run in parallel; the next wave only starts once the prior wave is fully green. Don't stop between waves, ever.

Tasks in the same wave may never touch the same files — PM enforces this at planning time.

Per-task gate sequence:

```
🧭 Orchestrator: assign task
  → tooling: create per-task log*
  → 🔨 Builder writes production code
  → 🧪 Tester ensures all tests pass                  [Gate]
  → 🔍 Reviewer code review (pass/fail)               [Gate]
  → 🛡 Security review (pass/fail)                    [Gate]
  → tooling: verification (build/test/lint/types)*    [Gate]
  → tooling: commit*
  → 📐 PM reports done
```

---

## ♻️ Failure & Retry

**4-strike, any-kind counter per task.** Any gate failure (review, security, verification) counts toward the same counter.

| Strike | Action                                                                  |
|--------|-------------------------------------------------------------------------|
| 1–2    | Orchestrator routes feedback back to Builder. Task restarts in-flight from scratch. |
| 3      | Orchestrator pulls in Architect to help resolve. Builder retries once more. |
| 4      | **Halt the entire sprint run.** Orchestrator notifies human with logs + diff. |

**Other failure modes:**
- **Architectural review failure (final)**: not auto-retried. Reported to human during polish; any fix becomes a new `polish-{n}` task.
- **System/run crash**: Orchestrator uses `sprint-state.json` (not log-parsing) to determine restart point. In-flight tasks always restart from scratch — no partial recovery. Logs note "hard restart".

---

## ♻️ Idempotency of the Pipeline

- `sprint-state.json` is tooling-managed and updated on every gate transition. It is the source of truth for restart.
- In-flight tasks on crash: **always restart from scratch**. Partial recovery is where crap code lives.
- The app pipeline itself must also be idempotent (per `CLAUDE.md` and `SPEC.md`), but that is an application concern, not an orchestration concern.

---

## 🏁 Final Review (when all tasks complete)

Interactive. Orchestrator walks the human through the sprint for sign-off.

```
🧭 Orchestrator
  → 🏛 Architect final review (pass/fail)
  → Summary of work + triage list
  → ✋ Human review and polish
       (any fix = new polish-{n} task through the full gate loop)
  → 📐 PM updates /docs/architecture.md (targeted sections, living doc)
  → 📐 PM appends to /docs/project_memory.md (newest sprint on top)
  → 📐 PM updates README.md
  → ✋ Human approves doc updates
  → tooling: merge commit sprint/{name} → main*
  → ✅ Done
```

---

## 🚨 Escalation

If the Builder cannot produce acceptable code after strike 3:

1. Orchestrator + Architect huddle to resolve.
2. If unresolved after one more retry (strike 4), **halt the entire sprint** and surface to human with full logs and current diff.

Escalation is always logged in `sprint.log` with the reason and the state of the failing task.
