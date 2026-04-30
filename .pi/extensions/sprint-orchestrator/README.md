# 🧭 sprint-orchestrator extension

Deterministic spine for the sprint process defined in [`/ORCHESTRATION.md`](../../../ORCHESTRATION.md). Owns every `*`-marked step so agents cannot drift state.

## What it guarantees

- ✋ **Refuses to work on `main`** — warns on startup, disables sprint tools until you're on `sprint/{name}`.
- 🔒 **Only tooling may commit/merge/push** — ad-hoc `git commit|merge|push|reset|rebase|cherry-pick` from the model is blocked unless it originates from `commit_task` / `sprint_merge`.
- 🧱 **File ownership enforced** — during a task's builder phase, `write`/`edit` outside declared files is refused.
- 📒 **Single source of truth** — `sprint-state.json` is the only restart oracle. Log parsing is never used for state recovery.
- 🧪 **Verify is binary** — `verify_run` either returns green for all five steps or the task goes back to builder.
- 🎯 **One commit per task** — `commit_task` refuses unless every gate is green; message format is fixed.

## Tools (model-callable)

| Tool | Purpose |
|---|---|
| `sprint_start` | Create branch + sprint dir + state file. Idempotent. |
| `sprint_state_get` | Read current state. |
| `sprint_state_transition` | Advance a task to the next gate on PASS. Refuses illegal edges. |
| `task_log_append` | Append to `{task-id}-{agent}-{attempt}.log`. |
| `strike_record` | Record a gate FAIL. Halts sprint on strike 4. |
| `verify_run` | Run install/build/test/lint/types. Gate 4. |
| `commit_task` | Author the one commit per task. Refuses unless all green. |
| `sprint_merge` | Merge `sprint/{name}` → `main` with `--no-ff`. |

## Commands (human-facing)

| Command | Purpose |
|---|---|
| `/sprint:status` | Summary of current state. |
| `/sprint:resume` | Rebind `ACTIVE_SPRINT` from current branch. |
| `/sprint:approve-planning` | Flip phase `planning` → `planning-approved`. |
| `/sprint:approve-close` | Trigger `sprint_merge`. |
| `/sprint:halt` | Manual strike-4. |

## Not yet wired (next sprint)

- `wave_dispatch` — PM-time wave parallelism + file-overlap check.
- `polish_task_create` — post-final-review polish-{n} tasks through the full gate loop.
- PM doc-update pipeline (`architecture.md`, `project_memory.md`, `README.md`).

## Files

```
index.ts    # registers tools, commands, guards; caches ACTIVE_SPRINT
state.ts    # SprintState types + legal gate transitions + strike counter
git.ts      # branch/commit/merge helpers; AUTHORIZED flag for bash guard
verify.ts   # runs the verification pipeline, returns structured results
guards.ts   # on-main refusal, bash-git guard, ownership guard
paths.ts    # sprint dir layout (one place to rename things)
```
