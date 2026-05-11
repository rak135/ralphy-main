import { describe, expect, it } from "bun:test";
import type { Task } from "../tasks/types.ts";
import { resolveEffectiveExecution, resolveStartupRoutingSummary } from "./engine-resolution.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
	return { id: "test", title: "Test task", completed: false, ...overrides };
}

describe("resolveStartupRoutingSummary", () => {
	it("uses PRD defaults.engine over CLI fallback", () => {
		const tasks: Task[] = [makeTask()];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: { engine: "opencode", model: "deepseek-v4", engineArgs: ["--variant", "high"] },
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: ["--fast"],
			tasks,
		});
		expect(summary.defaultEngineName).toBe("opencode");
		expect(summary.defaultModel).toBe("deepseek-v4");
		expect(summary.defaultEngineArgs).toEqual(["--variant", "high"]);
		expect(summary.hasTaskEngineOverrides).toBe(false);
	});

	it("falls back to CLI engine when PRD defaults.engine absent", () => {
		const tasks: Task[] = [makeTask()];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: undefined,
			cliEngineName: "claude",
			cliModelOverride: "sonnet",
			cliEngineArgs: ["--fast"],
			tasks,
		});
		expect(summary.defaultEngineName).toBe("claude");
		expect(summary.defaultModel).toBe("sonnet");
		expect(summary.defaultEngineArgs).toEqual(["--fast"]);
	});

	it("detects task engine overrides", () => {
		const tasks: Task[] = [makeTask({ engine: "codex" })];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: { engine: "opencode" },
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: undefined,
			tasks,
		});
		expect(summary.hasTaskEngineOverrides).toBe(true);
		expect(summary.distinctEngines).toContain("opencode");
		expect(summary.distinctEngines).toContain("codex");
	});

	it("reports distinct engines across tasks", () => {
		const tasks: Task[] = [
			makeTask({ engine: "opencode", id: "t1" }),
			makeTask({ engine: "codex", id: "t2" }),
			makeTask({ engine: "gemini", id: "t3" }),
		];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: { engine: "claude" },
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: undefined,
			tasks,
		});
		expect(summary.distinctEngines.length).toBe(4); // claude, opencode, codex, gemini
		expect(summary.distinctEngines).toContain("claude");
		expect(summary.distinctEngines).toContain("opencode");
		expect(summary.distinctEngines).toContain("codex");
		expect(summary.distinctEngines).toContain("gemini");
	});

	it("detects task model overrides", () => {
		const tasks: Task[] = [makeTask({ model: "gpt-5.5" })];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: undefined,
			cliEngineName: "claude",
			cliModelOverride: "sonnet",
			cliEngineArgs: undefined,
			tasks,
		});
		expect(summary.hasTaskModelOverrides).toBe(true);
		expect(summary.defaultModel).toBe("sonnet");
	});

	it("detects task engine args overrides", () => {
		const tasks: Task[] = [makeTask({ engineArgs: ["--temperature", "0"] })];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: undefined,
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: undefined,
			tasks,
		});
		expect(summary.hasTaskEngineArgsOverrides).toBe(true);
	});

	it("does not flag same engine as override", () => {
		const tasks: Task[] = [makeTask({ engine: "opencode" })];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: { engine: "opencode" },
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: undefined,
			tasks,
		});
		expect(summary.hasTaskEngineOverrides).toBe(false);
		expect(summary.distinctEngines).toEqual(["opencode"]);
	});

	it("isolates CLI args when PRD engine differs from CLI engine", () => {
		const tasks: Task[] = [makeTask()];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: { engine: "opencode" },
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: ["--fast"],
			tasks,
		});
		expect(summary.defaultEngineName).toBe("opencode");
		expect(summary.defaultEngineArgs).toBeUndefined();
	});

	it("propagates CLI args when no PRD engine and same CLI engine", () => {
		const tasks: Task[] = [makeTask()];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: undefined,
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: ["--fast"],
			tasks,
		});
		expect(summary.defaultEngineArgs).toEqual(["--fast"]);
	});

	it("propagates CLI args when PRD engine equals CLI engine", () => {
		const tasks: Task[] = [makeTask()];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: { engine: "claude" },
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: ["--fast"],
			tasks,
		});
		expect(summary.defaultEngineArgs).toEqual(["--fast"]);
	});

	it("empty tasks array produces only the default engine", () => {
		const tasks: Task[] = [];
		const summary = resolveStartupRoutingSummary({
			prdDefaults: undefined,
			cliEngineName: "claude",
			cliModelOverride: undefined,
			cliEngineArgs: undefined,
			tasks,
		});
		expect(summary.defaultEngineName).toBe("claude");
		expect(summary.distinctEngines).toEqual(["claude"]);
		expect(summary.hasTaskEngineOverrides).toBe(false);
	});
});

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
