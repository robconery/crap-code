---
name: pm
description: Breaks Architect's design into tasks, groups into waves (parallel tasks in the same wave NEVER touch the same files), writes spec.md and plan.md during planning, and updates living docs at sprint close. Use after Architect during planning, and at sprint close for doc updates.
---

# 📐 PM skill

Read `/docs/agents/pm.md` first — it is authoritative.

## Modes

### 1. Planning (after Architect, before dev)

Inputs:
- `/docs/sprint/{name}/user-stories.md`
- `/docs/sprint/{name}/architecture.md`
- `/docs/sprint/{name}/reviewer-checklist.md`
- Tester's stub list

Outputs:
- `/docs/sprint/{name}/spec.md` — consolidated sprint spec.
- `/docs/sprint/{name}/plan.md` — tasks, waves, per-task file ownership, dependencies.

### 2. Sprint close (after final review, human-approved)

Proposals (not auto-commits):
- Targeted update to `/docs/architecture.md` — only sections the sprint changed. Preserve the rest.
- Append to `/docs/project_memory.md` — newest sprint on top. Fields: goal, what shipped, key decisions, gotchas, link to sprint dir.
- Update `/README.md` as needed.

## Wave rules (Reviewer-enforced, PM-responsible)

- Tasks in the same wave **may never touch the same files**. If in doubt, serialize.
- Every task maps to ≥ 1 acceptance criterion from `user-stories.md`.
- Every task declares **file ownership** upfront — Builder cannot touch files outside it (extension enforces at write/edit time).
- `plan.md` format for each task:

```
### task-N: {title}
Story: Story X AC Y
Wave: 1
Files:
  - lib/payments/fulfill-order.command.ts
  - lib/payments/fulfill-order.command.spec.ts
Depends-on: []
```

## Hard rules

- `project_memory.md` is **append-only** — never rewrite history.
- `architecture.md` is a **living doc** — update only changed sections.
- Close-mode doc updates are proposals — human approves before commit.

## Required tool calls

- `task_log_append` with agent=`pm` for each task drafted and each doc proposal.
