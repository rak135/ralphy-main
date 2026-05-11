import type { AIEngineName } from "../engines/types.ts";

export interface TaskExecutionRecord {
	taskId: string;
	taskTitle: string;
	status: "completed" | "failed" | "skipped" | "deferred";
	engineName: AIEngineName;
	/** Resolved model override, or undefined when using engine default */
	model?: string;
	/** Resolved engine args; empty array when none were used */
	engineArgs: string[];
	inputTokens?: number;
	outputTokens?: number;
	error?: string;
}
