/**
 * A single task to be executed
 */
export interface Task {
	/** Unique identifier (line number for markdown, index for yaml, issue number for github) */
	id: string;
	/** Task title/description */
	title: string;
	/** Full task body (for github issues) */
	body?: string;
	/** Parallel group number (0 = sequential, >0 = can run in parallel with same group) */
	parallelGroup?: number;
	/** Whether the task is completed */
	completed: boolean;
	/** Per-task model override (overrides global --model for this task only) */
	model?: string;
	/** Per-task engine args (replace global engineArgs for this task only) */
	engineArgs?: string[];
}

/**
 * Task source type
 */
export type TaskSourceType = "markdown" | "markdown-folder" | "yaml" | "json" | "github";

/**
 * Task source interface - one per format
 */
export interface TaskSource {
	/** Type of task source */
	type: TaskSourceType;
	/** Get all remaining (incomplete) tasks */
	getAllTasks(): Promise<Task[]>;
	/** Get the next task to execute */
	getNextTask(): Promise<Task | null>;
	/** Mark a task as complete */
	markComplete(id: string): Promise<void>;
	/** Count remaining tasks */
	countRemaining(): Promise<number>;
	/** Count completed tasks */
	countCompleted(): Promise<number>;
	/** Get tasks in a specific parallel group */
	getTasksInGroup?(group: number): Promise<Task[]>;
}
