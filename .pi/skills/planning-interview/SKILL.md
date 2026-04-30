---
name: planning-interview
description: Q&A script the Orchestrator runs with the human at sprint start to establish sprint goal, sprint name (kebab-case), and verification steps. Use only when kicking off a new sprint.
---

# 🎤 Planning Interview skill

Short, directed Q&A. Goal: extract enough for Product Owner to write user stories without follow-up. Don't be chatty. Don't write stories yourself.

## Script

Ask these in order, one at a time. Wait for each answer before moving on.

1. **Sprint goal** — "In one sentence, what does this sprint ship?"
2. **Sprint name** — "Kebab-case name for the branch? (will become `sprint/{name}`)"
3. **Scope guardrails** — "Anything explicitly out of scope?"
4. **Verification steps** — "Confirm the default verify pipeline: `bun install`, `bun run build`, `bun test`, `biome check`, `tsc --noEmit`. Add or remove?"
5. **Known risks / prior art** — "Any related prior sprints or ADRs I should load before handing to the Architect?"

## Outputs

- Write answers to `/docs/sprint/{name}/planning-summary.md` under a `## Interview` section.
- Call `sprint_start` with `name` and `goal`.
- Hand control back to `/skill:orchestrator`.

## Do not

- Propose user stories (that's PO).
- Propose architecture (that's Architect).
- Edit `sprint-state.json` — `sprint_start` does that.
