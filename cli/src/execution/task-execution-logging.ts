import { logInfo } from "../ui/logger.ts";
import type { TaskExecutionRecord } from "./task-execution-record.ts";

const STATUS_LABEL: Record<TaskExecutionRecord["status"], string> = {
	completed: "Completed",
	failed: "Failed",
	skipped: "Skipped",
	deferred: "Deferred",
};

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
	const argsStr = record.engineArgs.length > 0 ? record.engineArgs.join(" ") : "(none)";

	logInfo(`[${label}] ${record.taskTitle}`);
	logInfo(`  Engine:      ${record.engineName}`);
	logInfo(`  Model:       ${modelStr}`);
	logInfo(`  Engine args: ${argsStr}`);
}
