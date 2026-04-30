# 🧭 Pi wiring for Big Machine fulfillment

Auto-discovered by [pi](https://pi.dev) from `cwd`. Nothing here needs to be installed — pi picks it up on startup.

## 🧩 Extension

- **[`extensions/sprint-orchestrator/`](./extensions/sprint-orchestrator/)** — deterministic spine for the sprint process in [`/ORCHESTRATION.md`](../ORCHESTRATION.md). Owns git, state machine, verification pipeline, commit/merge, strike counter, file-ownership enforcement.

See its [README](./extensions/sprint-orchestrator/README.md) for tools and commands.

## 🧠 Skills

One per agent in the team + one shared checklist. Invoke explicitly with `/skill:{name}` or let the model load on-match.

| Skill | Phase | Owns gate |
|---|---|---|
| [`orchestrator`](./skills/orchestrator/SKILL.md) | All | — |
| [`planning-interview`](./skills/planning-interview/SKILL.md) | Planning kickoff | — |
| [`product-owner`](./skills/product-owner/SKILL.md) | Planning | — |
| [`architect`](./skills/architect/SKILL.md) | Planning + Final | Final architectural review |
| [`pm`](./skills/pm/SKILL.md) | Planning + Close | — |
| [`tester`](./skills/tester/SKILL.md) | Planning + Dev | Tests pass (Gate 1) |
| [`builder`](./skills/builder/SKILL.md) | Dev | — |
| [`reviewer`](./skills/reviewer/SKILL.md) | Dev | Code review (Gate 2) |
| [`security`](./skills/security/SKILL.md) | Dev | Security review (Gate 3) |
| [`styleguide-check`](./skills/styleguide-check/SKILL.md) | Shared | — |

## 🔁 The split

> **Deterministic = extension. Judgement = skill.**

The `*` markers in `ORCHESTRATION.md` are the dividing line:

- Anything with `*` (branch create, commit, verify, merge, state writes, log file naming, strike counter) lives in the extension. Skills cannot bypass it — the extension's guards block ad-hoc `git commit|merge|push` from the `bash` tool, refuse writes outside declared file ownership, and refuse to work on `main`.
- Everything else (writing stories, designing architecture, writing code, reviewing, testing, doc updates) lives in skills. Skills call the extension's tools to persist state and move the gate machine.

## 🚧 Not yet wired

- `wave_dispatch` — PM-time wave parallelism + file-overlap validation.
- `polish_task_create` — post-final-review polish-{n} tasks through the full gate loop.
- PM close-phase doc-update pipeline automation.

## 🧪 Trying it out

```bash
cd /path/to/repo
pi
```

On startup you should see the extension loaded. If you're on `main`, it will warn per `CLAUDE.md` rule. Switch to a sprint branch (or call `sprint_start`) to proceed.

```
/sprint:status        # show current state
/skill:orchestrator   # drive the sprint
```
