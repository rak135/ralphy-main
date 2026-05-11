import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { AIEngine } from "../engines/types.ts";
import { CachedTaskSource } from "../tasks/index.ts";
import { JsonTaskSource } from "../tasks/json.ts";
import { runSequential } from "./sequential.ts";

function createSuccessfulEngine(fileName = "implementation.txt"): AIEngine {
	return {
		name: "Test Engine",
		cliCommand: "test-engine",
		isAvailable: async () => true,
		execute: async (_prompt: string, workDir: string) => {
			writeFileSync(join(workDir, fileName), "implemented\n", "utf-8");
			return {
				success: true,
				response: "done",
				inputTokens: 10,
				outputTokens: 5,
			};
		},
	};
}

async function createRepoFixture(): Promise<{
	workDir: string;
	prdPath: string;
	git: ReturnType<typeof simpleGit>;
}> {
	const workDir = mkdtempSync(join(tmpdir(), "ralphy-sequential-"));
	const ralphyDir = join(workDir, ".ralphy");
	const prdPath = join(workDir, "PRD.json");

	mkdirSync(ralphyDir, { recursive: true });
	writeFileSync(
		join(ralphyDir, "config.yaml"),
		[
			"project:",
			'  name: "test"',
			'  language: "TypeScript"',
			'  framework: "none"',
			'  description: ""',
			"commands:",
			'  test: ""',
			'  lint: ""',
			'  build: ""',
			"rules: []",
			"boundaries:",
			"  never_touch: []",
			"",
		].join("\n"),
		"utf-8",
	);
	writeFileSync(join(ralphyDir, "progress.txt"), "# Ralphy Progress Log\n\n", "utf-8");
	writeFileSync(
		prdPath,
		JSON.stringify(
			{
				name: "Test PRD",
				tasks: [
					{
						title: "Implement deterministic commit",
						description: "Create one file.",
						completed: false,
					},
				],
			},
			null,
			2,
		),
		"utf-8",
	);

	const git = simpleGit(workDir);
	await git.init();
	await git.addConfig("user.name", "Ralphy Test");
	await git.addConfig("user.email", "ralphy-test@example.com");
	await git.add(".");
	await git.commit("Initial commit");

	return { workDir, prdPath, git };
}

describe("runSequential deterministic commits", () => {
	let workDir: string | null = null;

	beforeEach(() => {
		workDir = null;
	});

	afterEach(() => {
		if (workDir && existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("commits task changes only after PRD completion has been persisted", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;
		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: true,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		const latestMessage = await fixture.git.raw(["log", "-1", "--pretty=%B"]);
		const committedPrd = JSON.parse(await fixture.git.show(["HEAD:PRD.json"])) as {
			tasks: Array<{ completed?: boolean }>;
		};
		const status = await fixture.git.status();

		expect(result.tasksCompleted).toBe(1);
		expect(result.tasksFailed).toBe(0);
		expect(latestMessage).toContain("Ralphy: Implement deterministic commit");
		expect(latestMessage).toContain("State: completed");
		expect(committedPrd.tasks[0]?.completed).toBe(true);
		expect(status.files.length).toBe(0);
		expect(readFileSync(fixture.prdPath, "utf-8")).toContain('"completed": true');
	});

	it("leaves completed task changes uncommitted when autoCommit is disabled", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;
		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine("no-commit.txt"),
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		const latestMessage = await fixture.git.raw(["log", "-1", "--pretty=%B"]);
		const status = await fixture.git.status();

		expect(result.tasksCompleted).toBe(1);
		expect(result.tasksFailed).toBe(0);
		expect(latestMessage).toContain("Initial commit");
		expect(readFileSync(fixture.prdPath, "utf-8")).toContain('"completed": true');
		expect(status.files.length).toBeGreaterThan(0);
	});
});

describe("runSequential per-task engine resolution", () => {
	let workDir: string | null = null;

	afterEach(() => {
		if (workDir && existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("uses engineFactory to create task-specific engine when cliEngineName is set", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		// Write a PRD with a task that overrides the engine
		writeFileSync(
			fixture.prdPath,
			JSON.stringify(
				{
					tasks: [{ title: "Engine override task", completed: false, engine: "opencode" }],
				},
				null,
				2,
			),
			"utf-8",
		);

		const createdEngineNames: string[] = [];
		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (name) => {
				createdEngineNames.push(name);
				return createSuccessfulEngine();
			},
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.tasksCompleted).toBe(1);
		expect(createdEngineNames).toContain("opencode");
	});

	it("falls back to passed engine when cliEngineName is not set", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		let executeCalled = false;
		const fallbackEngine = {
			...createSuccessfulEngine(),
			execute: async (_p: string, _w: string) => {
				executeCalled = true;
				return { success: true, response: "done", inputTokens: 0, outputTokens: 0 };
			},
		};

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: fallbackEngine,
			// cliEngineName intentionally omitted
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.tasksCompleted).toBe(1);
		expect(executeCalled).toBe(true);
	});
});

describe("runSequential taskExecutions records", () => {
	let workDir: string | null = null;

	beforeEach(() => {
		workDir = null;
	});

	afterEach(() => {
		if (workDir && existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("records one completed record per executed task", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].status).toBe("completed");
		expect(result.taskExecutions[0].taskTitle).toBe("Implement deterministic commit");
	});

	it("records effective engine name from cliEngineName + task override", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		// Write a PRD with a task that explicitly overrides the engine
		writeFileSync(
			fixture.prdPath,
			JSON.stringify(
				{ tasks: [{ title: "Engine task", completed: false, engine: "opencode" }] },
				null,
				2,
			),
			"utf-8",
		);

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(),
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].engineName).toBe("opencode");
	});

	it("records inherited CLI model as effective model in the record", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(),
			modelOverride: "claude-opus-4-5",
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].model).toBe("claude-opus-4-5");
	});

	it("records undefined model (engine default) when no model is configured", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(),
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].model).toBeUndefined();
	});

	it("records empty engineArgs when none configured", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(),
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].engineArgs).toEqual([]);
	});

	it("records resolved engineArgs when set via CLI", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(),
			engineArgs: ["--fast"],
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].engineArgs).toEqual(["--fast"]);
	});

	it("records failed task with status=failed and error field", async () => {
		const fixture = await createRepoFixture();
		workDir = fixture.workDir;

		const failingEngine: AIEngine = {
			name: "Failing Engine",
			cliCommand: "failing",
			isAvailable: async () => true,
			execute: async () => ({ success: false, error: "Boom", inputTokens: 0, outputTokens: 0 }),
		};

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runSequential({
			engine: failingEngine,
			cliEngineName: "claude",
			engineFactory: (_name) => failingEngine,
			taskSource,
			workDir: fixture.workDir,
			skipTests: true,
			skipLint: true,
			dryRun: false,
			maxIterations: 1,
			maxRetries: 1,
			retryDelay: 0,
			branchPerTask: false,
			baseBranch: "",
			createPr: false,
			draftPr: false,
			autoCommit: false,
			browserEnabled: "false",
			prdFile: "PRD.json",
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].status).toBe("failed");
		expect(result.taskExecutions[0].error).toBe("Boom");
	});
});
