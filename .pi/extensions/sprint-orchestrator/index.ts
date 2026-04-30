/**
 * Sprint Orchestrator extension.
 *
 * Owns every deterministic step in ORCHESTRATION.md (the ones marked `*`).
 * Agents/skills call these tools to move state forward; they cannot mutate
 * sprint-state.json, git history, or the verification pipeline by any other
 * means (guards in ./guards.ts block the common side-doors).
 *
 * Design rule: no business judgement lives here. Every decision this module
 * makes is mechanical (legal transition? gate green? branch clean?). All
 * prose, design, code review etc. lives in skills.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { Type } from "typebox";
import { commitTask, currentBranch, mergeSprint, startSprintBranch } from "./git.js";
import { installBashGitGuard, installOwnershipGuard, installStartupGuard, readStateIfAny } from "./guards.js";
import { ensureSprintDirs, sprintPaths, taskLogPath, type SprintPaths } from "./paths.js";
import {
	findTask,
	loadState,
	readyToCommit,
	recordStrike,
	saveState,
	transition,
	type Gate,
	type SprintState,
	type TaskState,
} from "./state.js";
import { DEFAULT_STEPS, runVerify } from "./verify.js";

// A pi session only works on one sprint at a time. We cache its name so tools
// don't each have to rediscover it. `/sprint:new` and `/sprint:resume` set it.
// Persists across tool calls within a session; reset on shutdown.
let ACTIVE_SPRINT: string | undefined;

function requireActive(cwd: string): { state: SprintState; paths: SprintPaths } {
	if (!ACTIVE_SPRINT) throw new Error("no active sprint — call sprint_start or /sprint:resume first");
	const paths = sprintPaths(cwd, ACTIVE_SPRINT);
	const state = loadState(paths);
	if (!state) throw new Error(`sprint ${ACTIVE_SPRINT} has no state file at ${paths.state}`);
	return { state, paths };
}

function appendSprintLog(paths: SprintPaths, line: string): void {
	const ts = new Date().toISOString();
	appendFileSync(paths.sprintLog, `[${ts}] ${line}\n`);
}

// Exposed to guards so writes get constrained to the in-flight task's files.
// "In-flight" = any task not in builder/done. Builder gate IS writing, so it's
// the one phase where we care about ownership.
function getActiveTaskForGuard(
	ctx: ExtensionContext,
): { state: SprintState; paths: SprintPaths; task: TaskState } | undefined {
	if (!ACTIVE_SPRINT) return undefined;
	const paths = sprintPaths(ctx.cwd, ACTIVE_SPRINT);
	const state = readStateIfAny(paths);
	if (!state) return undefined;
	const task = state.tasks.find((t) => t.gate === "builder" && !t.completedAt);
	if (!task) return undefined;
	return { state, paths, task };
}

export default function (pi: ExtensionAPI) {
	// --- guards (always on) -----------------------------------------------
	installStartupGuard(pi);
	installBashGitGuard(pi);
	installOwnershipGuard(pi, getActiveTaskForGuard);

	// --- footer widget ----------------------------------------------------
	// Keeps the human oriented without needing to run /sprint:status.
	pi.on("session_start", async (_event, ctx) => {
		const br = await currentBranch(pi).catch(() => "?");
		const m = br.match(/^sprint\/(.+)$/);
		if (m) {
			ACTIVE_SPRINT = m[1];
			const paths = sprintPaths(ctx.cwd, ACTIVE_SPRINT);
			const state = readStateIfAny(paths);
			if (state) {
				ctx.ui.setStatus("sprint", statusLine(state));
			}
		}
	});

	// --- tools -------------------------------------------------------------

	pi.registerTool({
		name: "sprint_start",
		label: "Sprint start",
		description: "Create sprint/{name} branch, scaffold /docs/sprint/{name}/, init sprint-state.json. Idempotent.",
		parameters: Type.Object({
			name: Type.String({ description: "Sprint name (kebab-case)" }),
			goal: Type.String({ description: "One-line sprint goal" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const name = params.name as string;
			const goal = params.goal as string;
			const paths = sprintPaths(ctx.cwd, name);
			ensureSprintDirs(paths);
			await startSprintBranch(pi, `sprint/${name}`);
			if (!existsSync(paths.state)) {
				const state: SprintState = {
					name,
					branch: `sprint/${name}`,
					phase: "planning",
					createdAt: new Date().toISOString(),
					tasks: [],
				};
				saveState(paths, state);
				writeFileSync(paths.sprintLog, `# Sprint: ${name}\nGoal: ${goal}\n`);
			}
			ACTIVE_SPRINT = name;
			appendSprintLog(paths, `sprint_start name=${name}`);
			return { content: [{ type: "text", text: `Sprint ${name} ready on branch sprint/${name}.` }], details: {} };
		},
	});

	pi.registerTool({
		name: "sprint_state_get",
		label: "Sprint state get",
		description: "Read the current sprint-state.json. Source of truth for all restart decisions.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const { state } = requireActive(ctx.cwd);
			return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }], details: state };
		},
	});

	pi.registerTool({
		name: "sprint_state_transition",
		label: "Sprint state transition",
		description: "Advance a task to the next gate after a PASS. Refuses illegal transitions.",
		parameters: Type.Object({
			taskId: Type.String(),
			to: Type.String({ description: "Target gate: tester|reviewer|security|verify|commit|done" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { state, paths } = requireActive(ctx.cwd);
			const task = findTask(state, params.taskId as string);
			transition(task, params.to as Gate);
			saveState(paths, state);
			appendSprintLog(paths, `transition ${task.id} -> ${task.gate}`);
			return { content: [{ type: "text", text: `${task.id} -> ${task.gate}` }], details: {} };
		},
	});

	pi.registerTool({
		name: "task_log_append",
		label: "Task log append",
		description: "Append a timestamped line to the per-task log. Use for every significant agent step.",
		parameters: Type.Object({
			taskId: Type.String(),
			agent: Type.String({ description: "orchestrator|po|architect|pm|tester|builder|reviewer|security" }),
			attempt: Type.Number(),
			line: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { paths } = requireActive(ctx.cwd);
			const file = taskLogPath(paths, params.taskId as string, params.agent as string, params.attempt as number);
			appendFileSync(file, `[${new Date().toISOString()}] ${params.line as string}\n`);
			return { content: [{ type: "text", text: `logged to ${file}` }], details: {} };
		},
	});

	pi.registerTool({
		name: "strike_record",
		label: "Strike record",
		description: "Record a gate failure against a task. Halts sprint on strike 4. Task restarts from builder.",
		parameters: Type.Object({
			taskId: Type.String(),
			gate: Type.String({ description: "tester|reviewer|security|verify" }),
			reason: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { state, paths } = requireActive(ctx.cwd);
			const task = findTask(state, params.taskId as string);
			const strikes = recordStrike(task, params.gate as Gate, params.reason as string);
			let halted = false;
			if (strikes >= 4) {
				state.halted = {
					reason: `task ${task.id} reached strike 4 at gate ${params.gate}: ${params.reason}`,
					at: new Date().toISOString(),
				};
				halted = true;
				console.error(`[sprint] HALT: ${state.halted.reason}`);
			}
			saveState(paths, state);
			appendSprintLog(paths, `strike ${strikes} ${task.id} gate=${params.gate}${halted ? " HALTED" : ""}`);
			return {
				content: [
					{
						type: "text",
						text: halted
							? `STRIKE 4 — SPRINT HALTED. Surface to human with logs + diff.`
							: strikes === 3
								? `STRIKE 3 — pull in architect before builder retry.`
								: `Strike ${strikes}/4 on ${task.id}. Restart from builder.`,
					},
				],
				details: { strikes, halted },
			};
		},
	});

	pi.registerTool({
		name: "verify_run",
		label: "Verify run",
		description:
			"Runs the deterministic verification pipeline (install/build/test/lint/types). Gate 4 — nothing commits until this is green.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const { state, paths } = requireActive(ctx.cwd);
			const result = await runVerify(pi, DEFAULT_STEPS);
			appendSprintLog(
				paths,
				`verify ${result.ok ? "PASS" : `FAIL@${result.failedStep}`} (${result.steps.length} steps)`,
			);
			// We don't mutate state here — the caller (skill/orchestrator) decides
			// whether to transition forward or record a strike. Keeps verify pure.
			void state;
			return {
				content: [
					{
						type: "text",
						text: result.ok
							? `✅ verify green (${result.steps.map((s) => s.name).join(", ")})`
							: `❌ verify failed at "${result.failedStep}"`,
					},
				],
				details: result,
				isError: !result.ok,
			};
		},
	});

	pi.registerTool({
		name: "commit_task",
		label: "Commit task",
		description:
			"Authors the single commit for a task. Refuses unless every gate is green. Uses the ORCHESTRATION.md message format.",
		parameters: Type.Object({
			taskId: Type.String(),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { state, paths } = requireActive(ctx.cwd);
			const task = findTask(state, params.taskId as string);
			if (!readyToCommit(task)) {
				console.error(`[sprint] commit_task refused: ${task.id} gates not all green`);
				throw new Error(`task ${task.id} is not ready to commit — gates: ${JSON.stringify(task.gates)}`);
			}
			const gateSummary = `Builder: ✅  Tester: ✅  Reviewer: ✅  Security: ✅  Verify: ✅`;
			const sha = await commitTask(pi, {
				sprintName: state.name,
				taskId: task.id,
				title: task.title,
				storyRef: task.story,
				gateSummary,
				files: task.files,
			});
			task.commitSha = sha;
			transition(task, "done");
			saveState(paths, state);
			appendSprintLog(paths, `commit ${task.id} sha=${sha}`);
			return { content: [{ type: "text", text: `committed ${task.id} @ ${sha}` }], details: { sha } };
		},
	});

	pi.registerTool({
		name: "sprint_merge",
		label: "Sprint merge",
		description:
			"Close the sprint: merge sprint/{name} into main with --no-ff. Refuses if phase != final-review or working tree dirty.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const { state, paths } = requireActive(ctx.cwd);
			if (state.phase !== "final-review") {
				throw new Error(`cannot merge: phase is ${state.phase}, expected final-review`);
			}
			const sha = await mergeSprint(pi, state.branch);
			state.phase = "closed";
			saveState(paths, state);
			appendSprintLog(paths, `merged into main sha=${sha}`);
			return { content: [{ type: "text", text: `merged ${state.branch} → main @ ${sha}` }], details: { sha } };
		},
	});

	// --- commands ----------------------------------------------------------

	pi.registerCommand("sprint:status", {
		description: "Show sprint state summary",
		handler: async (_args, ctx) => {
			try {
				const { state } = requireActive(ctx.cwd);
				ctx.ui.notify(statusLine(state), "info");
			} catch (err) {
				ctx.ui.notify(`${(err as Error).message}`, "warning");
			}
		},
	});

	pi.registerCommand("sprint:resume", {
		description: "Resume the sprint on the current branch (reads sprint-state.json)",
		handler: async (_args, ctx) => {
			const br = await currentBranch(pi).catch(() => "");
			const m = br.match(/^sprint\/(.+)$/);
			if (!m) {
				ctx.ui.notify(`Not on a sprint branch (currently ${br}).`, "error");
				return;
			}
			ACTIVE_SPRINT = m[1];
			const { state } = requireActive(ctx.cwd);
			ctx.ui.notify(`Resumed sprint ${state.name} (phase=${state.phase})`, "info");
		},
	});

	pi.registerCommand("sprint:approve-planning", {
		description: "Human approval gate: flips phase planning -> planning-approved",
		handler: async (_args, ctx) => {
			const { state, paths } = requireActive(ctx.cwd);
			if (state.phase !== "planning") {
				ctx.ui.notify(`cannot approve planning: phase is ${state.phase}`, "error");
				return;
			}
			state.phase = "planning-approved";
			saveState(paths, state);
			appendSprintLog(paths, "human approved planning-summary.md");
			ctx.ui.notify("Planning approved. PM may now write spec.md & plan.md.", "info");
		},
	});

	pi.registerCommand("sprint:approve-close", {
		description: "Human approval gate: triggers sprint_merge (sprint -> main)",
		handler: async (_args, ctx) => {
			await (async () => {
				const tool = pi.getAllTools().find((t) => t.name === "sprint_merge");
				if (!tool) return;
				// Route through the tool so guards and log writes apply.
				// We invoke via a user message so it's visible in the transcript.
				pi.sendUserMessage("Please call sprint_merge to close the sprint.", { deliverAs: "followUp" });
			})();
			void ctx;
		},
	});

	pi.registerCommand("sprint:halt", {
		description: "Manually halt the sprint (equivalent to strike 4)",
		handler: async (args, ctx) => {
			const { state, paths } = requireActive(ctx.cwd);
			state.halted = { reason: args || "manual halt", at: new Date().toISOString() };
			saveState(paths, state);
			appendSprintLog(paths, `manual HALT: ${state.halted.reason}`);
			console.error(`[sprint] HALT: ${state.halted.reason}`);
			ctx.ui.notify(`Sprint halted: ${state.halted.reason}`, "error");
		},
	});
}

function statusLine(state: SprintState): string {
	const parts = [
		`sprint/${state.name}`,
		state.phase,
		state.currentWave !== undefined ? `wave ${state.currentWave}` : "",
		`${state.tasks.filter((t) => t.gate === "done").length}/${state.tasks.length} done`,
	];
	if (state.halted) parts.push(`⛔ HALTED`);
	return parts.filter(Boolean).join(" · ");
}
