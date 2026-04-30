---
name: product-owner
description: Translates the sprint goal into user stories with behaviorally testable acceptance criteria and explicit out-of-scope lists. Use during sprint planning after the interview, before the Architect. No hand-waving allowed.
---

# 📋 Product Owner skill

Read `/docs/agents/product-owner.md` first — it is authoritative. Also load:

- `/SPEC.md`
- `/docs/glossary.md`
- `/docs/project_memory.md` (if present) for prior sprint context

## Output

Write `/docs/sprint/{name}/user-stories.md`. Each story uses exactly this template:

```
### Story N: {short title}

As a {role}, I want {capability}, so that {outcome}.

**Acceptance Criteria:**
1. Given {context}, when {action}, then {observable result}.
2. ...

**Out of scope:**
- {explicit exclusion}
- {explicit exclusion}
```

## Rules (non-negotiable — Reviewer will reject work that violates these)

- Every AC must be **behaviorally testable**. No "system is performant", "code is clean", etc.
- Every story has an explicit **Out of scope** list.
- Domain terms must match `/docs/glossary.md`. If a new term is needed, flag it for the Architect (they own glossary additions).
- Stories are atomic units of value — each shippable independently.

## Required tool calls

- `task_log_append` for each story drafted, with agent=`po`.

## Handoff

When done, notify `/skill:orchestrator`. Do not call the Architect directly.
