import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import simpleGit from "simple-git";
import type { AIEngine } from "../engines/types.ts";
import { JsonTaskSource } from "../tasks/json.ts";
import { CachedTaskSource } from "../tasks/index.ts";
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
