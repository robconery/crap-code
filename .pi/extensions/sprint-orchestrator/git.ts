/**
 * Git helpers for sprint lifecycle.
 *
 * All git mutations live here so we can reason about branch policy in one
 * spot. The extension's `bash` guard blocks ad-hoc `git commit|merge|push`
 * unless these helpers have set the `AUTHORIZED` flag for the duration of
 * one call — that's how we enforce "one commit per task, authored by tooling".
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// Module-level flag toggled by commitTask / mergeSprint. The `bash` tool_call
// guard reads it to decide whether to allow a git mutation originating from
// the model. Narrow window: set true, run, set false in `finally`.
let AUTHORIZED = false;

export function isGitAuthorized(): boolean {
	return AUTHORIZED;
}

async function authorized<T>(fn: () => Promise<T>): Promise<T> {
	AUTHORIZED = true;
	try {
		return await fn();
	} finally {
		AUTHORIZED = false;
	}
}

export async function currentBranch(pi: ExtensionAPI): Promise<string> {
	const { stdout, code } = await pi.exec("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
	if (code !== 0) throw new Error("not a git repo or HEAD detached");
	return stdout.trim();
}

export async function branchExists(pi: ExtensionAPI, branch: string): Promise<boolean> {
	const { code } = await pi.exec("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
	return code === 0;
}

/**
 * Create (or switch to, if exists) the sprint branch. Idempotent so restart
 * after a crash mid-planning does the right thing.
 */
export async function startSprintBranch(pi: ExtensionAPI, branch: string): Promise<void> {
	return authorized(async () => {
		if (await branchExists(pi, branch)) {
			const { code, stderr } = await pi.exec("git", ["checkout", branch]);
			if (code !== 0) throw new Error(`git checkout ${branch} failed: ${stderr}`);
			return;
		}
		const { code, stderr } = await pi.exec("git", ["checkout", "-b", branch]);
		if (code !== 0) throw new Error(`git checkout -b ${branch} failed: ${stderr}`);
	});
}

export interface CommitInput {
	sprintName: string;
	taskId: string;
	title: string;
	storyRef: string;
	gateSummary: string; // e.g. "Builder: ✅  Tester: ✅  ..."
	files: string[]; // declared file ownership — `git add` scope
}

/**
 * One commit per task. Message format is fixed by ORCHESTRATION.md so
 * downstream tooling (log readers, changelog builders) can rely on it.
 */
export async function commitTask(pi: ExtensionAPI, input: CommitInput): Promise<string> {
	return authorized(async () => {
		// Stage only the declared files — prevents scope creep into a sibling
		// task's ownership if the builder wandered. Reviewer should have caught
		// this, but defence in depth is cheap here.
		const add = await pi.exec("git", ["add", "--", ...input.files]);
		if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);

		const msg =
			`[sprint/${input.sprintName}] ${input.taskId}: ${input.title}\n\n` +
			`${input.storyRef}\n` +
			`${input.gateSummary}\n`;

		const commit = await pi.exec("git", ["commit", "-m", msg]);
		if (commit.code !== 0) throw new Error(`git commit failed: ${commit.stderr}`);

		const sha = await pi.exec("git", ["rev-parse", "HEAD"]);
		return sha.stdout.trim();
	});
}

/**
 * Sprint close: merge sprint branch into main with --no-ff so per-task
 * history is preserved. Refuses if the working tree is dirty.
 */
export async function mergeSprint(pi: ExtensionAPI, sprintBranch: string): Promise<string> {
	return authorized(async () => {
		const dirty = await pi.exec("git", ["status", "--porcelain"]);
		if (dirty.stdout.trim().length > 0) {
			throw new Error("working tree dirty — cannot merge");
		}
		const co = await pi.exec("git", ["checkout", "main"]);
		if (co.code !== 0) throw new Error(`git checkout main failed: ${co.stderr}`);
		const merge = await pi.exec("git", ["merge", "--no-ff", sprintBranch, "-m", `Merge ${sprintBranch}`]);
		if (merge.code !== 0) throw new Error(`git merge failed: ${merge.stderr}`);
		const sha = await pi.exec("git", ["rev-parse", "HEAD"]);
		return sha.stdout.trim();
	});
}
