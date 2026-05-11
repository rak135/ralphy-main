import type { EngineOptions } from "../engines/types.ts";
import type { Task } from "../tasks/types.ts";

interface EngineDefaults {
	modelOverride?: string;
	engineArgs?: string[];
}

/**
 * Resolve effective engine options for a task.
 *
 * - task.model overrides defaults.modelOverride
 * - task.engineArgs replaces defaults.engineArgs (no merging)
 * - absent task fields fall back to defaults
 * - empty/undefined values are omitted from the returned object
 */
export function resolveEngineOptions(task: Task, defaults: EngineDefaults): EngineOptions {
	const model = task.model ?? defaults.modelOverride;
	const args = task.engineArgs ?? defaults.engineArgs;
	const opts: EngineOptions = {};
	if (model) opts.modelOverride = model;
	if (args && args.length > 0) opts.engineArgs = args;
	return opts;
}
