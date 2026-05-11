import { logInfo } from "../ui/logger.ts";
import type { TaskExecutionRecord } from "./task-execution-record.ts";

const STATUS_LABEL: Record<TaskExecutionRecord["status"], string> = {
	completed: "Completed",
	failed: "Failed",
	skipped: "Skipped",
	deferred: "Deferred",
};

/**
 * Format engine args for display.
 * Returns "(none)" when no args are set.
 */
export function formatEngineArgs(args?: string[]): string {
	return args && args.length > 0 ? args.join(" ") : "(none)";
}

/**
 * Log resolved routing for a task before execution starts.
 *
 * Example output:
 *   Engine: OpenCode
 *   Model: deepseek/deepseek-v4-pro
 *   Engine args: --variant high
 */
export function logResolvedTaskRouting(params: {
	engineName: string;
	model?: string;
	engineArgs?: string[];
}): void {
	logInfo(`  Engine: ${params.engineName}`);
	if (params.model) {
		logInfo(`  Model: ${params.model}`);
	}
	logInfo(`  Engine args: ${formatEngineArgs(params.engineArgs)}`);
}

/**
 * Print a structured routing summary for a single task execution.
 *
 * Example output:
 *   [Completed] My task title
 *     Engine:      claude
 *     Model:       claude-opus-4-5
 *     Engine args: --fast
 */
export function logTaskExecutionRecord(record: TaskExecutionRecord): void {
	const label = STATUS_LABEL[record.status];
	const modelStr = record.model ?? "engine default";
	const argsStr = formatEngineArgs(record.engineArgs);

	logInfo(`[${label}] ${record.taskTitle}`);
	logInfo(`  Engine:      ${record.engineName}`);
	logInfo(`  Model:       ${modelStr}`);
	logInfo(`  Engine args: ${argsStr}`);
}
