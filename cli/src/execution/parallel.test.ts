import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { AIEngine } from "../engines/types.ts";
import { CachedTaskSource } from "../tasks/index.ts";
import { JsonTaskSource } from "../tasks/json.ts";
import { runParallel } from "./parallel.ts";

function createSuccessfulEngine(name = "Test Engine"): AIEngine {
	return {
		name,
		cliCommand: "test-engine",
		isAvailable: async () => true,
		execute: async (_prompt: string, _workDir: string) => ({
			success: true,
			response: "done",
			inputTokens: 10,
			outputTokens: 5,
		}),
	};
}

async function createRepoFixture(prdContent: object): Promise<{
	workDir: string;
	prdPath: string;
	git: ReturnType<typeof simpleGit>;
}> {
	const workDir = mkdtempSync(join(tmpdir(), "ralphy-parallel-"));
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
	writeFileSync(prdPath, JSON.stringify(prdContent, null, 2), "utf-8");

	const git = simpleGit(workDir);
	await git.init();
	await git.addConfig("user.name", "Ralphy Test");
	await git.addConfig("user.email", "ralphy-test@example.com");
	await git.add(".");
	await git.commit("Initial commit");

	return { workDir, prdPath, git };
}

describe("runParallel per-task engine resolution (sandbox mode)", () => {
	let workDir: string | null = null;

	beforeEach(() => {
		workDir = null;
	});

	afterEach(() => {
		if (workDir && existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("creates task-specific engine via engineFactory (sandbox)", async () => {
		const fixture = await createRepoFixture({
			tasks: [{ title: "Sandbox engine task", completed: false, engine: "opencode" }],
		});
		workDir = fixture.workDir;

		const createdEngineNames: string[] = [];
		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (name) => {
				createdEngineNames.push(name);
				return createSuccessfulEngine(name);
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		expect(result.tasksCompleted).toBe(1);
		expect(createdEngineNames).toContain("opencode");
	});

	it("uses CLI engine when task has no engine override (sandbox)", async () => {
		const fixture = await createRepoFixture({
			tasks: [{ title: "No engine override task", completed: false }],
		});
		workDir = fixture.workDir;

		const createdEngineNames: string[] = [];
		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (name) => {
				createdEngineNames.push(name);
				return createSuccessfulEngine(name);
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		// Task has no engine override, falls back to CLI engine "claude"
		expect(createdEngineNames).toContain("claude");
		expect(createdEngineNames).not.toContain("opencode");
	});

	it("uses PRD defaults engine when task has no engine override (sandbox)", async () => {
		const fixture = await createRepoFixture({
			defaults: { engine: "copilot" },
			tasks: [{ title: "PRD default engine task", completed: false }],
		});
		workDir = fixture.workDir;

		const createdEngineNames: string[] = [];
		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (name) => {
				createdEngineNames.push(name);
				return createSuccessfulEngine(name);
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		// PRD defaults engine = "copilot" should be used
		expect(createdEngineNames).toContain("copilot");
		expect(createdEngineNames).not.toContain("claude");
	});
});

describe("runParallel taskExecutions records", () => {
	let workDir: string | null = null;

	beforeEach(() => {
		workDir = null;
	});

	afterEach(() => {
		if (workDir && existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it("produces one record per completed task in sandbox mode", async () => {
		const fixture = await createRepoFixture({
			tasks: [{ title: "Task A", completed: false }],
		});
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(_name),
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].status).toBe("completed");
	});

	it("records task-specific engineName in sandbox record", async () => {
		const fixture = await createRepoFixture({
			tasks: [{ title: "Engine override task", completed: false, engine: "opencode" }],
		});
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (name) => createSuccessfulEngine(name),
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].engineName).toBe("opencode");
	});

	it("records resolved model in sandbox record", async () => {
		const fixture = await createRepoFixture({
			tasks: [{ title: "Model task", completed: false }],
		});
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runParallel({
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].model).toBe("claude-opus-4-5");
	});

	it("records inherited PRD default engineArgs in sandbox record", async () => {
		const fixture = await createRepoFixture({
			defaults: { engine: "claude", engine_args: ["--variant", "high"] },
			tasks: [{ title: "PRD default args task", completed: false }],
		});
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(_name),
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].engineArgs).toEqual(["--variant", "high"]);
	});

	it("records task-level engineArgs override in sandbox record", async () => {
		const fixture = await createRepoFixture({
			defaults: { engine: "claude", engine_args: ["--prd-arg"] },
			tasks: [
				{
					title: "Task arg override",
					completed: false,
					engine_args: ["-c", 'model_reasoning_effort="high"'],
				},
			],
		});
		workDir = fixture.workDir;

		const taskSource = new CachedTaskSource(new JsonTaskSource(fixture.prdPath), {
			flushIntervalMs: 0,
		});

		const result = await runParallel({
			engine: createSuccessfulEngine(),
			cliEngineName: "claude",
			engineFactory: (_name) => createSuccessfulEngine(_name),
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
			maxParallel: 2,
			prdSource: "json",
			useSandbox: true,
			skipMerge: true,
		});

		expect(result.taskExecutions).toHaveLength(1);
		expect(result.taskExecutions[0].engineArgs).toEqual(["-c", 'model_reasoning_effort="high"']);
	});
});
