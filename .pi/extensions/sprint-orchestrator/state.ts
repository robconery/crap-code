/**
 * Sprint state machine.
 *
 * `sprint-state.json` is the single source of truth for restart — per
 * ORCHESTRATION.md we never reconstruct state by log-parsing. Every mutation
 * goes through `transition()` so illegal transitions are refused loudly
 * (no silent failure — see CLAUDE.md).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import type { SprintPaths } from "./paths.js";

// Gates mirror ORCHESTRATION.md's per-task sequence exactly. `done` is a
// terminal state. `halted` is reserved for strike-4 sprint halts.
export type Gate = "builder" | "tester" | "reviewer" | "security" | "verify" | "commit" | "done";

export type GateResult = "pending" | "pass" | "fail";

export interface Strike {
	attempt: number;
	gate: Gate;
	reason: string;
	timestamp: string;
}

export interface TaskState {
	id: string; // e.g. "task-3" or "polish-1"
	title: string;
	story: string; // user story reference, e.g. "Story 2 AC 1"
	files: string[]; // declared file ownership — enforced at wave dispatch + builder write
	wave: number;
	gate: Gate;
	attempts: number; // 4-strike any-kind counter
	strikes: Strike[];
	gates: Partial<Record<Gate, GateResult>>;
	startedAt?: string;
	completedAt?: string;
	commitSha?: string;
}

export type Phase =
	| "planning"
	| "planning-approved" // human signed planning-summary.md
	| "development"
	| "final-review"
	| "closed";

export interface SprintState {
	name: string;
	branch: string; // sprint/{name}
	phase: Phase;
	createdAt: string;
	currentWave?: number;
	tasks: TaskState[];
	halted?: { reason: string; at: string };
}

// Legal gate transitions per ORCHESTRATION.md. Any edge not here is refused.
// Restart-from-scratch (any gate -> builder) is allowed so retries wipe partial
// work, matching "In-flight tasks on crash: always restart from scratch".
const LEGAL_EDGES: Record<Gate, Gate[]> = {
	builder: ["tester", "builder"],
	tester: ["reviewer", "builder"],
	reviewer: ["security", "builder"],
	security: ["verify", "builder"],
	verify: ["commit", "builder"],
	commit: ["done", "builder"],
	done: [], // terminal
};

export function loadState(paths: SprintPaths): SprintState | undefined {
	if (!existsSync(paths.state)) return undefined;
	try {
		return JSON.parse(readFileSync(paths.state, "utf8")) as SprintState;
	} catch (err) {
		// Corrupt state file is a hard failure — refusing to silently recreate it
		// would hide data loss. Surface with a clear error per CLAUDE.md.
		console.error(`[sprint] failed to parse ${paths.state}:`, err);
		throw new Error(`Corrupt sprint-state.json at ${paths.state}. Repair or delete manually.`);
	}
}

export function saveState(paths: SprintPaths, state: SprintState): void {
	// Pretty-print so the file is diffable in git — the audit trail matters.
	writeFileSync(paths.state, `${JSON.stringify(state, null, 2)}\n`);
}

export function findTask(state: SprintState, taskId: string): TaskState {
	const task = state.tasks.find((t) => t.id === taskId);
	if (!task) throw new Error(`task not found: ${taskId}`);
	return task;
}

/**
 * Move a task from its current gate to `target`. Used on gate PASS.
 * Refuses illegal edges with a loud error so a skill can't route a task
 * around a gate by accident.
 */
export function transition(task: TaskState, target: Gate, result: GateResult = "pass"): void {
	const legal = LEGAL_EDGES[task.gate];
	if (!legal.includes(target)) {
		throw new Error(`illegal transition ${task.gate} -> ${target} for ${task.id}`);
	}
	task.gates[task.gate] = result;
	task.gate = target;
	if (target === "done") task.completedAt = new Date().toISOString();
}

/**
 * Record a gate failure. Any-kind counter per ORCHESTRATION.md:
 * strike 1–2 retry, strike 3 escalate to architect, strike 4 halt the sprint.
 * Returns the resulting strike number so the caller can react.
 */
export function recordStrike(task: TaskState, gate: Gate, reason: string): number {
	task.attempts += 1;
	task.strikes.push({
		attempt: task.attempts,
		gate,
		reason,
		timestamp: new Date().toISOString(),
	});
	task.gates[gate] = "fail";
	// On any failure the task restarts from scratch at the builder gate.
	// This is the "partial recovery is where crap code lives" rule.
	task.gate = "builder";
	return task.attempts;
}

/**
 * commit_task is only legal if every prior gate passed on the current attempt.
 * Encodes the invariant "commit only on all-green" in one place.
 */
export function readyToCommit(task: TaskState): boolean {
	return (
		task.gate === "commit" &&
		task.gates.builder !== "fail" &&
		task.gates.tester === "pass" &&
		task.gates.reviewer === "pass" &&
		task.gates.security === "pass" &&
		task.gates.verify === "pass"
	);
}
