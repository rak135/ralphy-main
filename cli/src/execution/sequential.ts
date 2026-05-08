import { chmodSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { flushAllProgressWrites, logTaskProgress } from "../config/writer.ts";
import type { AIEngine, AIResult } from "../engines/types.ts";
import { createTaskBranch, returnToBaseBranch } from "../git/branch.ts";
import { commitCompletedTask } from "../git/commit.ts";
import { syncPrdToIssue } from "../git/issue-sync.ts";
import { createPullRequest } from "../git/pr.ts";
import type { Task, TaskSource } from "../tasks/types.ts";
import { logDebug, logError, logInfo, logSuccess, logWarn } from "../ui/logger.ts";
import { notifyTaskComplete, notifyTaskFailed } from "../ui/notify.ts";
import { ProgressSpinner } from "../ui/spinner.ts";
import { isCancellationError } from "./cancel.ts";
import { clearDeferredTask, recordDeferredTask } from "./deferred.ts";
import { buildPrompt } from "./prompt.ts";
import { isFatalError, isRetryableError, sleep, withRetry } from "./retry.ts";

function getStateFilePaths(workDir: string, prdFile?: string): string[] {
	const stateFiles = [
		prdFile,
		".ralphy/config.yaml",
		".ralphy/progress.txt",
	].filter((file): file is string => Boolean(file));

	const paths: string[] = [];
	const seen = new Set<string>();

	for (const file of stateFiles) {
		const filePath = resolve(workDir, file);
		if (seen.has(filePath) || !existsSync(filePath)) continue;
		seen.add(filePath);

		const stat = statSync(filePath);
		if (!stat.isFile()) continue;

		paths.push(filePath);
	}

	return paths;
}

function makeStateFilesWritable(workDir: string, prdFile?: string): void {
	for (const filePath of getStateFilePaths(workDir, prdFile)) {
		try {
			const stat = statSync(filePath);
			chmodSync(filePath, stat.mode | 0o600);
		} catch {
			// Best-effort guard recovery. The write that follows will surface any real failure.
		}
	}
}

function protectStateFilesDuringAgent(workDir: string, prdFile?: string): () => void {
	makeStateFilesWritable(workDir, prdFile);

	for (const filePath of getStateFilePaths(workDir, prdFile)) {
		const stat = statSync(filePath);
		const readOnlyMode = stat.mode & ~0o222;

		try {
			chmodSync(filePath, readOnlyMode);
		} catch {
			// Best-effort guard. Prompt boundaries still apply if the filesystem refuses chmod.
		}
	}

	return () => {
		makeStateFilesWritable(workDir, prdFile);
	};
}

async function markTaskCompleteAndFlush(
	taskSource: TaskSource,
	task: Task,
	workDir: string,
	prdFile?: string,
): Promise<void> {
	makeStateFilesWritable(workDir, prdFile);
	await taskSource.markComplete(task.id);

	const flush = (taskSource as TaskSource & { flush?: () => Promise<void> }).flush;
	if (typeof flush === "function") {
		await flush.call(taskSource);
	}
}

async function logTaskProgressAndFlush(
	taskTitle: string,
	status: "completed" | "failed",
	workDir: string,
	prdFile?: string,
): Promise<void> {
	makeStateFilesWritable(workDir, prdFile);
	logTaskProgress(taskTitle, status, workDir);
	await flushAllProgressWrites();
}

export interface ExecutionOptions {
	engine: AIEngine;
	taskSource: TaskSource;
	workDir: string;
	skipTests: boolean;
	skipLint: boolean;
	dryRun: boolean;
	maxIterations: number;
	maxRetries: number;
	retryDelay: number;
	branchPerTask: boolean;
	baseBranch: string;
	createPr: boolean;
	draftPr: boolean;
	autoCommit: boolean;
	browserEnabled: "auto" | "true" | "false";
	prdFile?: string;
	/** Active settings to display in spinner */
	activeSettings?: string[];
	/** Override default model for the engine */
	modelOverride?: string;
	/** Skip automatic branch merging after parallel execution */
	skipMerge?: boolean;
	/** Use lightweight sandboxes instead of git worktrees for parallel execution */
	useSandbox?: boolean;
	/** Additional arguments to pass to the engine CLI */
	engineArgs?: string[];
	/** GitHub issue number to sync PRD with on each iteration */
	syncIssue?: number;
}

export interface ExecutionResult {
	tasksCompleted: number;
	tasksFailed: number;
	totalInputTokens: number;
	totalOutputTokens: number;
}

/**
 * Run tasks sequentially
 */
export async function runSequential(options: ExecutionOptions): Promise<ExecutionResult> {
	const {
		engine,
		taskSource,
		workDir,
		skipTests,
		skipLint,
		dryRun,
		maxIterations,
		maxRetries,
		retryDelay,
		branchPerTask,
		baseBranch,
		createPr,
		draftPr,
		autoCommit,
		browserEnabled,
		activeSettings,
		modelOverride,
		engineArgs,
		syncIssue,
	} = options;

	const result: ExecutionResult = {
		tasksCompleted: 0,
		tasksFailed: 0,
		totalInputTokens: 0,
		totalOutputTokens: 0,
	};

	let iteration = 0;
	let abortDueToRetryableFailure = false;

	while (true) {
		// Check iteration limit
		if (maxIterations > 0 && iteration >= maxIterations) {
			logInfo(`Reached max iterations (${maxIterations})`);
			break;
		}

		// Get next task
		const task = await taskSource.getNextTask();
		if (!task) {
			logSuccess("All tasks completed!");
			break;
		}

		iteration++;
		const remaining = await taskSource.countRemaining();
		logInfo(`Task ${iteration}: ${task.title} (${remaining} remaining)`);

		// Create branch if needed
		let branch: string | null = null;
		if (branchPerTask && baseBranch) {
			try {
				branch = await createTaskBranch(task.title, baseBranch, workDir);
				logDebug(`Created branch: ${branch}`);
			} catch (error) {
				logError(`Failed to create branch: ${error}`);
			}
		}

		// Build prompt
		const prompt = buildPrompt({
			task: task.body || task.title,
			autoCommit,
			workDir,
			browserEnabled,
			skipTests,
			skipLint,
			prdFile: options.prdFile,
		});

		// Execute with spinner
		const spinner = new ProgressSpinner(task.title, activeSettings);
		let aiResult: AIResult | null = null;

		if (dryRun) {
			spinner.success("(dry run) Skipped");
		} else {
			let restoreStateWrites = () => {};
			try {
				restoreStateWrites = protectStateFilesDuringAgent(workDir, options.prdFile);
				aiResult = await withRetry(
					async () => {
						spinner.updateStep("Working");

						// Use streaming if available
						const engineOptions = {
							...(modelOverride && { modelOverride }),
							...(engineArgs && engineArgs.length > 0 && { engineArgs }),
						};
						if (engine.executeStreaming) {
							return await engine.executeStreaming(
								prompt,
								workDir,
								(step) => {
									spinner.updateStep(step);
								},
								engineOptions,
							);
						}

						const res = await engine.execute(prompt, workDir, engineOptions);

						if (!res.success && res.error && isRetryableError(res.error)) {
							throw new Error(res.error);
						}

						return res;
					},
					{
						maxRetries,
						retryDelay,
						onRetry: (attempt) => {
							spinner.updateStep(`Retry ${attempt}`);
						},
					},
				);
				restoreStateWrites();

				if (aiResult.success) {
					spinner.success(undefined, true); // Show timing breakdown
					result.totalInputTokens += aiResult.inputTokens;
					result.totalOutputTokens += aiResult.outputTokens;

					// Mark task complete
					await markTaskCompleteAndFlush(taskSource, task, workDir, options.prdFile);
					await logTaskProgressAndFlush(task.title, "completed", workDir, options.prdFile);

					if (autoCommit) {
						const commitHash = await commitCompletedTask(task, workDir);
						if (commitHash) {
							logSuccess(`Committed completed task: ${commitHash.slice(0, 7)}`);
						} else {
							logInfo("No git changes to commit after task completion");
						}
					}

					result.tasksCompleted++;

					// Sync PRD to GitHub issue if configured
					if (syncIssue && options.prdFile) {
						await syncPrdToIssue(options.prdFile, syncIssue, workDir);
					}

					notifyTaskComplete(task.title);
					clearDeferredTask(taskSource.type, task, workDir, options.prdFile);

					// Create PR if needed
					if (createPr && branch && baseBranch) {
						const prUrl = await createPullRequest(
							branch,
							baseBranch,
							task.title,
							`Automated PR created by Ralphy\n\n${aiResult.response}`,
							draftPr,
							workDir,
						);

						if (prUrl) {
							logSuccess(`PR created: ${prUrl}`);
						}
					}
				} else {
					const errMsg = aiResult.error || "Unknown error";
					if (isRetryableError(errMsg)) {
						const deferrals = recordDeferredTask(taskSource.type, task, workDir, options.prdFile);
						spinner.error(errMsg);
						if (deferrals >= maxRetries) {
							logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errMsg}`);
							await logTaskProgressAndFlush(task.title, "failed", workDir, options.prdFile);
							result.tasksFailed++;
							notifyTaskFailed(task.title, errMsg);
							await markTaskCompleteAndFlush(taskSource, task, workDir, options.prdFile);
							clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
						} else {
							logWarn(`Temporary failure, stopping early (${deferrals}/${maxRetries}): ${errMsg}`);
							result.tasksFailed++;
							abortDueToRetryableFailure = true;
						}
					} else if (isFatalError(errMsg)) {
						// Fatal error (auth, config) - abort all remaining tasks
						spinner.error(errMsg);
						logError(`Fatal error: ${errMsg}`);
						logError("Aborting remaining tasks due to configuration/authentication issue.");
						result.tasksFailed++;
						notifyTaskFailed(task.title, errMsg);
						return result; // Exit immediately
					} else {
						spinner.error(errMsg);
						await logTaskProgressAndFlush(task.title, "failed", workDir, options.prdFile);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errMsg);
						// Mark task complete so we don't retry it infinitely
						await markTaskCompleteAndFlush(taskSource, task, workDir, options.prdFile);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					}
				}
			} catch (error) {
				restoreStateWrites();
				if (isCancellationError(error)) {
					spinner.error("Cancelled by user");
					logWarn(`Cancelled. Task "${task.title}" was left incomplete.`);
					break;
				}

				const errorMsg = error instanceof Error ? error.message : String(error);
				if (isRetryableError(errorMsg)) {
					const deferrals = recordDeferredTask(taskSource.type, task, workDir, options.prdFile);
					spinner.error(errorMsg);
					if (deferrals >= maxRetries) {
						logError(`Task "${task.title}" failed after ${deferrals} deferrals: ${errorMsg}`);
						await logTaskProgressAndFlush(task.title, "failed", workDir, options.prdFile);
						result.tasksFailed++;
						notifyTaskFailed(task.title, errorMsg);
						await markTaskCompleteAndFlush(taskSource, task, workDir, options.prdFile);
						clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
					} else {
						logWarn(`Temporary failure, stopping early (${deferrals}/${maxRetries}): ${errorMsg}`);
						result.tasksFailed++;
						abortDueToRetryableFailure = true;
					}
				} else if (isFatalError(errorMsg)) {
					// Fatal error (auth, config) - abort all remaining tasks
					spinner.error(errorMsg);
					logError(`Fatal error: ${errorMsg}`);
					logError("Aborting remaining tasks due to configuration/authentication issue.");
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMsg);
					return result; // Exit immediately
				} else {
					spinner.error(errorMsg);
					await logTaskProgressAndFlush(task.title, "failed", workDir, options.prdFile);
					result.tasksFailed++;
					notifyTaskFailed(task.title, errorMsg);
					// Mark task complete so we don't retry it infinitely
					await markTaskCompleteAndFlush(taskSource, task, workDir, options.prdFile);
					clearDeferredTask(taskSource.type, task, workDir, options.prdFile);
				}
			}
		}

		// Return to base branch if we created one
		if (branchPerTask && baseBranch) {
			await returnToBaseBranch(baseBranch, workDir);
		}

		if (abortDueToRetryableFailure) {
			break;
		}
	}

	return result;
}
