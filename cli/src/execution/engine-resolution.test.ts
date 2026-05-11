import { describe, expect, it } from "bun:test";
import type { Task } from "../tasks/types.ts";
import { resolveEffectiveExecution } from "./engine-resolution.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
	return { id: "test", title: "Test task", completed: false, ...overrides };
}

describe("resolveEffectiveExecution", () => {
	// Engine name resolution
	it("prefers task.engine over PRD defaults engine", () => {
		const task = makeTask({ engine: "copilot" });
		const { engineName } = resolveEffectiveExecution(
			task,
			{ engine: "opencode" },
			{ engineName: "claude" },
		);
		expect(engineName).toBe("copilot");
	});

	it("prefers PRD defaults engine over CLI engine", () => {
		const task = makeTask();
		const { engineName } = resolveEffectiveExecution(
			task,
			{ engine: "opencode" },
			{ engineName: "claude" },
		);
		expect(engineName).toBe("opencode");
	});

	it("falls back to CLI engine when task and PRD have no engine", () => {
		const task = makeTask();
		const { engineName } = resolveEffectiveExecution(task, undefined, { engineName: "claude" });
		expect(engineName).toBe("claude");
	});

	it("falls back to CLI engine when PRD defaults is undefined", () => {
		const task = makeTask();
		const { engineName } = resolveEffectiveExecution(task, undefined, { engineName: "codex" });
		expect(engineName).toBe("codex");
	});

	// Model resolution
	it("prefers task.model over PRD defaults model", () => {
		const task = makeTask({ model: "task-model" });
		const { engineOptions } = resolveEffectiveExecution(
			task,
			{ model: "prd-model" },
			{ engineName: "claude", modelOverride: "cli-model" },
		);
		expect(engineOptions.modelOverride).toBe("task-model");
	});

	it("prefers PRD defaults model over CLI modelOverride", () => {
		const task = makeTask();
		const { engineOptions } = resolveEffectiveExecution(
			task,
			{ model: "prd-model" },
			{ engineName: "claude", modelOverride: "cli-model" },
		);
		expect(engineOptions.modelOverride).toBe("prd-model");
	});

	it("falls back to CLI modelOverride when no task or PRD model", () => {
		const task = makeTask();
		const { engineOptions } = resolveEffectiveExecution(task, undefined, {
			engineName: "claude",
			modelOverride: "cli-model",
		});
		expect(engineOptions.modelOverride).toBe("cli-model");
	});

	// engineArgs resolution
	it("uses task.engineArgs over PRD defaults", () => {
		const task = makeTask({ engineArgs: ["--task-arg"] });
		const { engineOptions } = resolveEffectiveExecution(
			task,
			{ engineArgs: ["--prd-arg"] },
			{ engineName: "claude", engineArgs: ["--cli-arg"] },
		);
		expect(engineOptions.engineArgs).toEqual(["--task-arg"]);
	});

	it("uses PRD defaults engineArgs over CLI args", () => {
		const task = makeTask();
		const { engineOptions } = resolveEffectiveExecution(
			task,
			{ engineArgs: ["--prd-arg"] },
			{ engineName: "claude", engineArgs: ["--cli-arg"] },
		);
		expect(engineOptions.engineArgs).toEqual(["--prd-arg"]);
	});

	it("uses CLI engineArgs when effective engine matches CLI engine", () => {
		const task = makeTask();
		const { engineOptions } = resolveEffectiveExecution(task, undefined, {
			engineName: "claude",
			engineArgs: ["--cli-arg"],
		});
		expect(engineOptions.engineArgs).toEqual(["--cli-arg"]);
	});

	it("does not pass CLI engineArgs to a different effective engine", () => {
		const task = makeTask({ engine: "opencode" });
		const { engineOptions } = resolveEffectiveExecution(task, undefined, {
			engineName: "claude",
			engineArgs: ["--cli-arg"],
		});
		expect(engineOptions.engineArgs).toBeUndefined();
	});

	it("does not pass CLI engineArgs when PRD engine differs from CLI engine", () => {
		const task = makeTask();
		const { engineOptions } = resolveEffectiveExecution(
			task,
			{ engine: "copilot" },
			{ engineName: "claude", engineArgs: ["--cli-arg"] },
		);
		expect(engineOptions.engineArgs).toBeUndefined();
	});

	it("empty task.engineArgs suppresses all arg sources", () => {
		const task = makeTask({ engineArgs: [] });
		const { engineOptions } = resolveEffectiveExecution(
			task,
			{ engineArgs: ["--prd-arg"] },
			{ engineName: "claude", engineArgs: ["--cli-arg"] },
		);
		expect(engineOptions.engineArgs).toBeUndefined();
	});

	it("omits engineOptions fields when nothing is set", () => {
		const task = makeTask();
		const { engineOptions } = resolveEffectiveExecution(task, undefined, { engineName: "claude" });
		expect(engineOptions.modelOverride).toBeUndefined();
		expect(engineOptions.engineArgs).toBeUndefined();
	});
});
