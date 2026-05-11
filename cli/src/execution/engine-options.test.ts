import { describe, expect, it } from "bun:test";
import type { Task } from "../tasks/types.ts";
import { resolveEngineOptions } from "./engine-options.ts";

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: "test",
		title: "Test task",
		completed: false,
		...overrides,
	};
}

describe("resolveEngineOptions", () => {
	it("prefers task.model over global modelOverride", () => {
		const task = makeTask({ model: "task-model" });
		const opts = resolveEngineOptions(task, { modelOverride: "global-model" });
		expect(opts.modelOverride).toBe("task-model");
	});

	it("falls back to global modelOverride when task.model is absent", () => {
		const task = makeTask();
		const opts = resolveEngineOptions(task, { modelOverride: "global-model" });
		expect(opts.modelOverride).toBe("global-model");
	});

	it("uses task.engineArgs instead of global engineArgs (no merging)", () => {
		const task = makeTask({ engineArgs: ["--task-arg"] });
		const opts = resolveEngineOptions(task, { engineArgs: ["--global-arg"] });
		expect(opts.engineArgs).toEqual(["--task-arg"]);
	});

	it("falls back to global engineArgs when task.engineArgs is absent", () => {
		const task = makeTask();
		const opts = resolveEngineOptions(task, { engineArgs: ["--global-arg"] });
		expect(opts.engineArgs).toEqual(["--global-arg"]);
	});

	it("does not merge task and global engineArgs", () => {
		const task = makeTask({ engineArgs: ["--task-arg"] });
		const opts = resolveEngineOptions(task, { engineArgs: ["--global-arg"] });
		expect(opts.engineArgs).toEqual(["--task-arg"]);
		expect(opts.engineArgs).not.toContain("--global-arg");
	});

	it("omits modelOverride when neither task nor global sets it", () => {
		const task = makeTask();
		const opts = resolveEngineOptions(task, {});
		expect(opts.modelOverride).toBeUndefined();
	});

	it("omits engineArgs when neither task nor global sets it", () => {
		const task = makeTask();
		const opts = resolveEngineOptions(task, {});
		expect(opts.engineArgs).toBeUndefined();
	});

	it("omits engineArgs when task provides an empty array", () => {
		const task = makeTask({ engineArgs: [] });
		const opts = resolveEngineOptions(task, { engineArgs: ["--global-arg"] });
		expect(opts.engineArgs).toBeUndefined();
	});
});
