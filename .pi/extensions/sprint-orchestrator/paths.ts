/**
 * Filesystem layout for sprint artifacts.
 *
 * Centralised here so the rest of the extension never hard-codes paths.
 * If ORCHESTRATION.md ever renames a file, we change it in one place.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Canonical sprint directory root. Tracked in source, never in ~/.pi.
// Keeps per-sprint artifacts colocated with the code they describe.
export const SPRINT_ROOT_REL = "docs/sprint";

export interface SprintPaths {
	root: string; // /docs/sprint/{name}
	state: string; // sprint-state.json
	sprintLog: string; // sprint.log (orchestrator narrative)
	logsDir: string; // logs/
	planningSummary: string;
	userStories: string;
	architecture: string;
	reviewerChecklist: string;
	spec: string;
	plan: string;
}

export function sprintPaths(cwd: string, sprintName: string): SprintPaths {
	const root = join(cwd, SPRINT_ROOT_REL, sprintName);
	return {
		root,
		state: join(root, "sprint-state.json"),
		sprintLog: join(root, "sprint.log"),
		logsDir: join(root, "logs"),
		planningSummary: join(root, "planning-summary.md"),
		userStories: join(root, "user-stories.md"),
		architecture: join(root, "architecture.md"),
		reviewerChecklist: join(root, "reviewer-checklist.md"),
		spec: join(root, "spec.md"),
		plan: join(root, "plan.md"),
	};
}

// `recursive: true` is idempotent — per CLAUDE.md the pipeline must tolerate
// repeated invocations without blowing up.
export function ensureSprintDirs(paths: SprintPaths): void {
	mkdirSync(paths.logsDir, { recursive: true });
}

// Per-task log filename convention from ORCHESTRATION.md:
// `{task-id}-{agent}-{attempt}.log`. Attempt is zero-padded to make lexical
// sort match chronological order.
export function taskLogPath(paths: SprintPaths, taskId: string, agent: string, attempt: number): string {
	const n = String(attempt).padStart(2, "0");
	return join(paths.logsDir, `${taskId}-${agent}-${n}.log`);
}
