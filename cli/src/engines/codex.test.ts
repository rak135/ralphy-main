import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as baseModule from "./base.ts";
import { CodexEngine } from "./codex.ts";

describe("CodexEngine engineArgs propagation", () => {
	let engine: CodexEngine;
	let workDir: string;

	afterEach(() => {
		if (workDir && existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
		engine = undefined as unknown as CodexEngine;
	});

	it("appends engineArgs to command args", async () => {
		engine = new CodexEngine();
		workDir = mkdtempSync(join(tmpdir(), "codex-test-"));
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test prompt", workDir, {
			engineArgs: ["-c", 'model_reasoning_effort="high"'],
		});

		expect(capturedArgs).toContain("-c");
		expect(capturedArgs).toContain('model_reasoning_effort="high"');
		spy.mockRestore();
	});

	it("appends multiple engineArgs in order", async () => {
		engine = new CodexEngine();
		workDir = mkdtempSync(join(tmpdir(), "codex-test-"));
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test", workDir, { engineArgs: ["--flag-a", "val-a", "--flag-b"] });

		const idxA = capturedArgs.indexOf("--flag-a");
		const idxB = capturedArgs.indexOf("--flag-b");
		expect(idxA).toBeGreaterThanOrEqual(0);
		expect(capturedArgs[idxA + 1]).toBe("val-a");
		expect(idxB).toBeGreaterThan(idxA);
		spy.mockRestore();
	});

	it("does not add engineArgs when none provided", async () => {
		engine = new CodexEngine();
		workDir = mkdtempSync(join(tmpdir(), "codex-test-"));
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test", workDir, {});

		expect(capturedArgs).not.toContain("-c");
		spy.mockRestore();
	});

	it("places modelOverride before engineArgs", async () => {
		engine = new CodexEngine();
		workDir = mkdtempSync(join(tmpdir(), "codex-test-"));
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test", workDir, {
			modelOverride: "gpt-5.5",
			engineArgs: ["-c", 'model_reasoning_effort="high"'],
		});

		const modelIdx = capturedArgs.indexOf("--model");
		const cIdx = capturedArgs.indexOf("-c");
		expect(modelIdx).toBeGreaterThanOrEqual(0);
		expect(cIdx).toBeGreaterThan(modelIdx);
		spy.mockRestore();
	});
});
