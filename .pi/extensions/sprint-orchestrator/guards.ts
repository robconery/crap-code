/**
 * Deterministic guardrails enforced regardless of what any skill asks for.
 *
 * These are the invariants from CLAUDE.md + ORCHESTRATION.md that must
 * never be silently bypassed:
 *   - Never run the sprint flow on `main`.
 *   - Only tooling (this extension) may git commit / merge / push.
 *   - Writes outside a running task's declared file ownership are refused.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isGitAuthorized } from "./git.js";
import { loadState, type SprintState, type TaskState } from "./state.js";
import type { SprintPaths } from "./paths.js";

// Commands that mutate history — allowed only when our commitTask/mergeSprint
// helpers have set the authorised flag. Everything else (status, diff, log,
// rev-parse) remains free.
const BLOCKED_GIT_SUBCOMMANDS = ["commit", "merge", "push", "reset", "rebase", "cherry-pick"];

function extractGitSubcommand(command: string): string | undefined {
	// Cheap parse — we only need to see the first `git <word>`. Good enough for
	// guard purposes; a determined user could still shell-escape around it, but
	// the point is to catch accidental model-initiated mutations.
	const m = command.match(/\bgit\s+([a-z-]+)/);
	return m?.[1];
}

export function installStartupGuard(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		const { stdout, code } = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
		if (code !== 0) return; // not a git repo — user's problem, not ours
		const branch = stdout.trim();
		if (branch === "main" || branch === "master") {
			// Loud notification, then we set a persistent status so it can't be
			// missed. We don't hard-exit — the user may just want to inspect
			// things. Rule per CLAUDE.md: recommend a branch, offer to create.
			console.error(`[sprint] refusing to run sprint flow on ${branch}`);
			ctx.ui.notify(
				`⚠ You're on ${branch}. Per CLAUDE.md, sprint work happens on sprint/{name}. Use /sprint:new or checkout a sprint branch.`,
				"warning",
			);
			ctx.ui.setStatus("sprint", `⚠ on ${branch} — sprint tools disabled`);
		}
	});
}

export function installBashGitGuard(pi: ExtensionAPI): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const command = (event.input as { command?: string }).command ?? "";
		const sub = extractGitSubcommand(command);
		if (!sub || !BLOCKED_GIT_SUBCOMMANDS.includes(sub)) return;
		if (isGitAuthorized()) return; // called from our own helpers
		console.error(`[sprint] blocked ad-hoc 'git ${sub}' — only commit_task/sprint_merge may mutate history`);
		ctx.ui.notify(`Blocked 'git ${sub}'. Use commit_task / sprint_merge tooling.`, "error");
		return { block: true, reason: `git ${sub} must go through sprint tooling (commit_task / sprint_merge)` };
	});
}

/**
 * Prevent writes outside the active task's declared file ownership.
 * Relies on `getActiveTask()` returning the single in-flight task; if more
 * than one task is active in a wave, each runs in its own pi session, so
 * "active task" is still unambiguous per-process.
 */
export function installOwnershipGuard(
	pi: ExtensionAPI,
	getActive: (ctx: ExtensionContext) => { state: SprintState; paths: SprintPaths; task: TaskState } | undefined,
): void {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return;
		const active = getActive(ctx);
		if (!active) return; // no sprint loaded — stay out of the way
		const path = (event.input as { path?: string }).path ?? "";
		// Sprint artifact writes are always allowed — skills write plan.md,
		// architecture.md, logs etc. outside their "file ownership".
		if (path.startsWith(active.paths.root)) return;
		const allowed = active.task.files.some((f) => path === f || path.startsWith(`${f}/`));
		if (!allowed) {
			console.error(`[sprint] builder wrote outside declared ownership: ${path}`);
			return {
				block: true,
				reason: `${path} is outside task ${active.task.id}'s declared file ownership: [${active.task.files.join(", ")}]`,
			};
		}
	});
}

export function readStateIfAny(paths: SprintPaths): SprintState | undefined {
	try {
		return loadState(paths);
	} catch (err) {
		console.error("[sprint] state read failed:", err);
		return undefined;
	}
}
