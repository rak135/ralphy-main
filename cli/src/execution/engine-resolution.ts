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
 * Summary of effective engine routing for startup display.
 * Computed from PRD defaults, CLI options, and all tasks.
 */
export interface StartupRoutingSummary {
	/** Resolved default engine name (prdDefaults.engine ?? cliEngineName) */
	defaultEngineName: string;
	/** Resolved default model (prdDefaults.model ?? cliModelOverride) */
	defaultModel: string | undefined;
	/** Resolved default engine args (prdDefaults.engineArgs ?? cliEngineArgs) */
	defaultEngineArgs: string[] | undefined;
	/** Whether any task explicitly sets a different engine */
	hasTaskEngineOverrides: boolean;
	/** Whether any task explicitly sets a different model */
	hasTaskModelOverrides: boolean;
	/** Whether any task explicitly sets different engine args */
	hasTaskEngineArgsOverrides: boolean;
	/** Distinct engine names used across all tasks after full resolution */
	distinctEngines: string[];
}

export function resolveStartupRoutingSummary(params: {
	prdDefaults: PrdDefaults | undefined;
	cliEngineName: AIEngineName;
	cliModelOverride: string | undefined;
	cliEngineArgs: string[] | undefined;
	tasks: Task[];
}): StartupRoutingSummary {
	const { prdDefaults, cliEngineName, cliModelOverride, cliEngineArgs, tasks } = params;

	const defaultEngineName = prdDefaults?.engine ?? cliEngineName;
	const defaultModel = prdDefaults?.model ?? cliModelOverride;

	const cliArgsEffective =
		defaultEngineName === cliEngineName && cliEngineArgs?.length ? cliEngineArgs : undefined;
	const defaultEngineArgs = prdDefaults?.engineArgs?.length
		? prdDefaults.engineArgs
		: cliArgsEffective;

	let hasTaskEngineOverrides = false;
	let hasTaskModelOverrides = false;
	let hasTaskEngineArgsOverrides = false;
	const distinctEngines = new Set<string>();
	distinctEngines.add(defaultEngineName);

	for (const task of tasks) {
		if (task.engine !== undefined && task.engine !== defaultEngineName) {
			hasTaskEngineOverrides = true;
		}
		if (task.model !== undefined) {
			hasTaskModelOverrides = true;
		}
		if (task.engineArgs !== undefined) {
			hasTaskEngineArgsOverrides = true;
		}
		distinctEngines.add(task.engine ?? defaultEngineName);
	}

	return {
		defaultEngineName,
		defaultModel,
		defaultEngineArgs,
		hasTaskEngineOverrides,
		hasTaskModelOverrides,
		hasTaskEngineArgsOverrides,
		distinctEngines: [...distinctEngines],
	};
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
