import type { AIEngineName, EngineOptions } from "../engines/types.ts";
import type { PrdDefaults, Task } from "../tasks/types.ts";

export interface CliEngineDefaults {
	/** Engine name chosen on the CLI */
	engineName: AIEngineName;
	/** Model override from --model flag */
	modelOverride?: string;
	/** Engine args from CLI -- passthrough */
	engineArgs?: string[];
}

export interface EffectiveExecution {
	/** Resolved engine name (task > PRD defaults > CLI) */
	engineName: string;
	/** Resolved engine options (model, args) */
	engineOptions: EngineOptions;
}

/**
 * Resolve the effective engine name and engine options for a single task.
 *
 * Resolution order:
 *   engineName : task.engine > prdDefaults.engine > cliDefaults.engineName
 *   model      : task.model  > prdDefaults.model  > cliDefaults.modelOverride
 *   engineArgs : task.engineArgs > prdDefaults.engineArgs > cliDefaults.engineArgs
 *                (cliDefaults.engineArgs only when the effective engine matches the CLI engine)
 *
 * An empty task.engineArgs array suppresses all other arg sources.
 */
export function resolveEffectiveExecution(
	task: Task,
	prdDefaults: PrdDefaults | undefined,
	cliDefaults: CliEngineDefaults,
): EffectiveExecution {
	const engineName = task.engine ?? prdDefaults?.engine ?? cliDefaults.engineName;

	const model = task.model ?? prdDefaults?.model ?? cliDefaults.modelOverride;

	let args: string[] | undefined;
	if (task.engineArgs !== undefined) {
		// Task always wins; empty array means "no args"
		args = task.engineArgs.length > 0 ? task.engineArgs : undefined;
	} else if (prdDefaults?.engineArgs !== undefined && prdDefaults.engineArgs.length > 0) {
		args = prdDefaults.engineArgs;
	} else if (engineName === cliDefaults.engineName) {
		// Only propagate CLI args when the effective engine is the CLI-selected engine
		args = cliDefaults.engineArgs?.length ? cliDefaults.engineArgs : undefined;
	}
	// If the effective engine differs from CLI and neither task nor PRD set args, args stays undefined

	const engineOptions: EngineOptions = {};
	if (model) engineOptions.modelOverride = model;
	if (args) engineOptions.engineArgs = args;

	return { engineName, engineOptions };
}
