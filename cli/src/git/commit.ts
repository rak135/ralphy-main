import simpleGit from "simple-git";
import type { Task } from "../tasks/types.ts";

export function buildCompletedTaskCommitMessage(task: Pick<Task, "id" | "title">): string {
	return `Ralphy: ${task.title}\n\nTask: ${task.id}\nState: completed`;
}

/**
 * Commit all current worktree changes after Ralphy has persisted task completion.
 *
 * Returns the new commit hash, or null when there is no git repo or nothing to commit.
 */
export async function commitCompletedTask(
	task: Pick<Task, "id" | "title">,
	workDir = process.cwd(),
): Promise<string | null> {
	const git = simpleGit(workDir);

	if (!(await git.checkIsRepo())) {
		return null;
	}

	const statusBeforeAdd = await git.status();
	if (statusBeforeAdd.files.length === 0) {
		return null;
	}

	await git.add("--all");

	const statusAfterAdd = await git.status();
	if (statusAfterAdd.files.length === 0) {
		return null;
	}

	const result = await git.commit(buildCompletedTaskCommitMessage(task));
	return result.commit || null;
}
