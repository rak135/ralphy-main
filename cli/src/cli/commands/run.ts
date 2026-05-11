import { existsSync } from "node:fs";
import { loadConfig } from "../../config/loader.ts";
import type { RuntimeOptions } from "../../config/types.ts";
import { createEngine, getEngineName } from "../../engines/index.ts";
import type { AIEngineName } from "../../engines/types.ts";
import { isBrowserAvailable } from "../../execution/browser.ts";
import { installCancellationHandlers, isCancellationRequested } from "../../execution/cancel.ts";
import { resolveStartupRoutingSummary } from "../../execution/engine-resolution.ts";
import { runParallel } from "../../execution/parallel.ts";
import { type ExecutionResult, runSequential } from "../../execution/sequential.ts";
import { getDefaultBaseBranch } from "../../git/branch.ts";
import { sendNotifications } from "../../notifications/webhook.ts";
import { CachedTaskSource, createTaskSource } from "../../tasks/index.ts";
import type { PrdDefaults } from "../../tasks/types.ts";
import {
	formatDuration,
	formatTokens,
	logError,
	logInfo,
	logSuccess,
	setVerbose,
} from "../../ui/logger.ts";
import { notifyAllComplete } from "../../ui/notify.ts";
import { buildActiveSettings } from "../../ui/settings.ts";

/**
 * Run the PRD loop (multiple tasks from file/GitHub)
 */
export async function runLoop(options: RuntimeOptions): Promise<void> {
	const workDir = process.cwd();
	const startTime = Date.now();
	const config = loadConfig(workDir);

	// Set verbose mode
	setVerbose(options.verbose);

	// Validate PRD source
	if (
		options.prdSource === "markdown" ||
		options.prdSource === "yaml" ||
		options.prdSource === "json"
	) {
		if (!existsSync(options.prdFile)) {
			logError(`${options.prdFile} not found in current directory`);
			logInfo(`Create a ${options.prdFile} file with tasks`);
			process.exit(1);
		}
	} else if (options.prdSource === "markdown-folder") {
		if (!existsSync(options.prdFile)) {
			logError(`PRD folder ${options.prdFile} not found`);
			logInfo(`Create a ${options.prdFile}/ folder with markdown files containing tasks`);
			process.exit(1);
		}
	}

	if (options.prdSource === "github" && !options.githubRepo) {
		logError("GitHub repository not specified. Use --github owner/repo");
		process.exit(1);
	}

	// Create task source with caching for better performance
	// Caching reduces file I/O by loading tasks once and batching writes
	const innerTaskSource = createTaskSource({
		type: options.prdSource,
		filePath: options.prdFile,
		repo: options.githubRepo,
		label: options.githubLabel,
	});
	const taskSource = new CachedTaskSource(innerTaskSource);

	// Read PRD-level defaults (only available for JSON/YAML sources)
	const prdDefaults =
		(innerTaskSource as { getPrdDefaults?: () => PrdDefaults | undefined }).getPrdDefaults?.() ??
		undefined;

	// Read all tasks for routing summary and remaining count
	const allTasks = await taskSource.getAllTasks();
	const remaining = allTasks.length;
	if (remaining === 0) {
		logSuccess("No tasks remaining. All done!");
		return;
	}

	// Compute startup routing summary
	const routingSummary = resolveStartupRoutingSummary({
		prdDefaults,
		cliEngineName: options.aiEngine as AIEngineName,
		cliModelOverride: options.modelOverride,
		cliEngineArgs: options.engineArgs,
		tasks: allTasks,
	});

	// Check availability of the effective default engine
	const effectiveDefaultEngineName = routingSummary.defaultEngineName as AIEngineName;
	let engine = createEngine(options.aiEngine as AIEngineName);
	try {
		engine = createEngine(effectiveDefaultEngineName);
	} catch {
		logError(`Unknown engine: ${effectiveDefaultEngineName}`);
		process.exit(1);
	}

	const available = await engine.isAvailable();
	if (!available) {
		logError(`${engine.name} CLI not found. Make sure '${engine.cliCommand}' is in your PATH.`);
		process.exit(1);
	}

	// Get base branch if needed
	let baseBranch = options.baseBranch;
	if ((options.branchPerTask || options.parallel || options.createPr) && !baseBranch) {
		baseBranch = await getDefaultBaseBranch(workDir);

		// Check if base branch is empty (unborn branch - no commits yet)
		if (!baseBranch) {
			logError("Cannot run in parallel/branch mode: repository has no commits yet.");
			logInfo("Please make an initial commit first:");
			logInfo('  git add . && git commit -m "Initial commit"');
			process.exit(1);
		}
	}

	// Startup banner using resolved defaults
	logInfo("Starting Ralphy");
	logInfo(`Default engine: ${engine.name}`);
	if (routingSummary.defaultModel) {
		logInfo(`Default model: ${routingSummary.defaultModel}`);
	}
	if (routingSummary.defaultEngineArgs?.length) {
		logInfo(`Default engine args: ${routingSummary.defaultEngineArgs.join(" ")}`);
	}
	if (routingSummary.distinctEngines.length > 1) {
		const engineLabels = routingSummary.distinctEngines.map((name) => {
			try {
				return getEngineName(name as AIEngineName);
			} catch {
				return name;
			}
		});
		logInfo(`Task engines: ${engineLabels.join(", ")}`);
	} else if (routingSummary.hasTaskEngineOverrides) {
		logInfo("Note: some tasks override the default engine");
	}
	logInfo(`Tasks remaining: ${remaining}`);
	if (options.parallel) {
		logInfo(`Mode: Parallel (max ${options.maxParallel} agents)`);
	} else {
		logInfo("Mode: Sequential");
	}
	if (isBrowserAvailable(options.browserEnabled)) {
		logInfo("Browser automation enabled (agent-browser)");
	}
	installCancellationHandlers({
		onFirstEsc: () => {
			logInfo("Esc pressed. Press Esc again within 2 seconds to stop Ralphy.");
		},
		onCancel: (activeProcessCount) => {
			if (activeProcessCount > 0) {
				logInfo("Stop requested. Stopping active agent process...");
			} else {
				logInfo("Stop requested. Stopping Ralphy...");
			}
		},
	});
	logInfo("Press Esc twice to stop Ralphy and leave the current task incomplete.");
	console.log("");

	// Build active settings for display
	const activeSettings = buildActiveSettings(options);

	// Run tasks
	let result: ExecutionResult;
	if (options.parallel) {
		result = await runParallel({
			engine,
			taskSource,
			workDir,
			skipTests: options.skipTests,
			skipLint: options.skipLint,
			dryRun: options.dryRun,
			maxIterations: options.maxIterations,
			maxRetries: options.maxRetries,
			retryDelay: options.retryDelay,
			branchPerTask: options.branchPerTask,
			baseBranch,
			createPr: options.createPr,
			draftPr: options.draftPr,
			autoCommit: options.autoCommit,
			browserEnabled: options.browserEnabled,
			maxParallel: options.maxParallel,
			prdSource: options.prdSource,
			prdFile: options.prdFile,
			prdIsFolder: options.prdIsFolder,
			activeSettings,
			useSandbox: options.useSandbox,
			modelOverride: options.modelOverride,
			skipMerge: options.skipMerge,
			engineArgs: options.engineArgs,
			syncIssue: options.syncIssue,
			cliEngineName: options.aiEngine as import("../../engines/types.ts").AIEngineName,
		});
	} else {
		result = await runSequential({
			engine,
			taskSource,
			workDir,
			skipTests: options.skipTests,
			skipLint: options.skipLint,
			dryRun: options.dryRun,
			maxIterations: options.maxIterations,
			maxRetries: options.maxRetries,
			retryDelay: options.retryDelay,
			branchPerTask: options.branchPerTask,
			baseBranch,
			createPr: options.createPr,
			draftPr: options.draftPr,
			autoCommit: options.autoCommit,
			browserEnabled: options.browserEnabled,
			activeSettings,
			prdFile: options.prdFile,
			modelOverride: options.modelOverride,
			skipMerge: options.skipMerge,
			engineArgs: options.engineArgs,
			syncIssue: options.syncIssue,
			cliEngineName: options.aiEngine as import("../../engines/types.ts").AIEngineName,
		});
	}

	// Flush any pending task completions to disk and cleanup
	await taskSource.flush();
	taskSource.dispose();

	if (isCancellationRequested()) {
		console.log("");
		logInfo("Cancelled by user. Current task was not marked complete.");
		process.exitCode = 130;
		return;
	}

	// Summary
	const duration = Date.now() - startTime;
	console.log("");
	console.log("=".repeat(50));
	logInfo("Summary:");
	console.log(`  Completed: ${result.tasksCompleted}`);
	console.log(`  Failed:    ${result.tasksFailed}`);
	console.log(`  Duration:  ${formatDuration(duration)}`);
	if (result.totalInputTokens > 0 || result.totalOutputTokens > 0) {
		console.log(`  Tokens:    ${formatTokens(result.totalInputTokens, result.totalOutputTokens)}`);
	}
	console.log("=".repeat(50));

	// Send webhook notifications
	const status = result.tasksFailed > 0 ? "failed" : "completed";
	await sendNotifications(config, status, {
		tasksCompleted: result.tasksCompleted,
		tasksFailed: result.tasksFailed,
	});

	if (result.tasksCompleted > 0) {
		notifyAllComplete(result.tasksCompleted);
	}

	if (result.tasksFailed > 0) {
		process.exit(1);
	}
}
