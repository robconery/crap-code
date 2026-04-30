/**
 * Verification gate (Gate 4 in ORCHESTRATION.md).
 *
 * These are the deterministic `*` steps the Orchestrator never performs
 * itself. Sequential (fail-fast) so a red test doesn't get masked by a
 * later typecheck error.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface VerifyStep {
	name: string;
	cmd: string;
	args: string[];
}

export interface VerifyStepResult {
	name: string;
	exitCode: number;
	stdoutTail: string;
	stderrTail: string;
}

export interface VerifyResult {
	ok: boolean;
	steps: VerifyStepResult[];
	failedStep?: string;
}

// Default verification steps from ORCHESTRATION.md "Verification steps"
// section. Overridable via the tool call so sprints with a different
// toolchain (e.g. wrangler deploy --dry-run) can swap in their own list
// without forking the extension.
export const DEFAULT_STEPS: VerifyStep[] = [
	{ name: "install", cmd: "bun", args: ["install"] },
	{ name: "build", cmd: "bun", args: ["run", "build"] },
	{ name: "test", cmd: "bun", args: ["test"] },
	{ name: "lint", cmd: "bunx", args: ["biome", "check", "."] },
	{ name: "typecheck", cmd: "bunx", args: ["tsc", "--noEmit"] },
];

// Keep only the tail — full output gets dumped to the per-task log elsewhere.
// Avoids bloating the state file or the model's context.
function tail(s: string, lines = 40): string {
	const arr = s.split("\n");
	return arr.slice(Math.max(0, arr.length - lines)).join("\n");
}

export async function runVerify(
	pi: ExtensionAPI,
	steps: VerifyStep[] = DEFAULT_STEPS,
): Promise<VerifyResult> {
	const results: VerifyStepResult[] = [];
	for (const step of steps) {
		const { stdout, stderr, code } = await pi.exec(step.cmd, step.args, { timeout: 10 * 60 * 1000 });
		const result: VerifyStepResult = {
			name: step.name,
			exitCode: code ?? -1,
			stdoutTail: tail(stdout),
			stderrTail: tail(stderr),
		};
		results.push(result);
		if (result.exitCode !== 0) {
			// Loud failure: print to console too, per CLAUDE.md "no silent failure".
			console.error(`[sprint] verify step "${step.name}" failed with exit ${result.exitCode}`);
			return { ok: false, steps: results, failedStep: step.name };
		}
	}
	return { ok: true, steps: results };
}
