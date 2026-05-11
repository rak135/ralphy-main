import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as baseModule from "./base.ts";
import { OpenCodeEngine } from "./opencode.ts";

describe("OpenCodeEngine engineArgs propagation", () => {
	let engine: OpenCodeEngine;

	afterEach(() => {
		engine = undefined as unknown as OpenCodeEngine;
	});

	it("appends engineArgs to command args", async () => {
		engine = new OpenCodeEngine();
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test prompt", "/tmp", { engineArgs: ["--variant", "high"] });

		expect(capturedArgs).toContain("--variant");
		expect(capturedArgs).toContain("high");
		spy.mockRestore();
	});

	it("appends multiple engineArgs in order", async () => {
		engine = new OpenCodeEngine();
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test", "/tmp", { engineArgs: ["--flag-a", "val-a", "--flag-b"] });

		const idxA = capturedArgs.indexOf("--flag-a");
		const idxB = capturedArgs.indexOf("--flag-b");
		expect(idxA).toBeGreaterThanOrEqual(0);
		expect(capturedArgs[idxA + 1]).toBe("val-a");
		expect(idxB).toBeGreaterThan(idxA);
		spy.mockRestore();
	});

	it("does not add engineArgs when none provided", async () => {
		engine = new OpenCodeEngine();
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test", "/tmp", {});

		expect(capturedArgs).not.toContain("--variant");
		spy.mockRestore();
	});

	it("places modelOverride before engineArgs", async () => {
		engine = new OpenCodeEngine();
		let capturedArgs: string[] = [];

		const spy = spyOn(baseModule, "execCommand").mockImplementation(
			async (_cmd: string, args: string[]) => {
				capturedArgs = args;
				return { stdout: "", stderr: "", exitCode: 0 };
			},
		);

		await engine.execute("test", "/tmp", {
			modelOverride: "deepseek/deepseek-v4-pro",
			engineArgs: ["--variant", "high"],
		});

		const modelIdx = capturedArgs.indexOf("--model");
		const variantIdx = capturedArgs.indexOf("--variant");
		expect(modelIdx).toBeGreaterThanOrEqual(0);
		expect(variantIdx).toBeGreaterThan(modelIdx);
		spy.mockRestore();
	});
});
