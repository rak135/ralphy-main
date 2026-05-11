import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { YamlTaskSource } from "./yaml.ts";

describe("YamlTaskSource model and engine_args", () => {
	function writeTempYaml(content: string): string {
		const dir = mkdtempSync(join(tmpdir(), "ralphy-yaml-test-"));
		const filePath = join(dir, "tasks.yaml");
		writeFileSync(filePath, content, "utf-8");
		return filePath;
	}

	it("preserves model and engine_args from getAllTasks", async () => {
		const filePath = writeTempYaml(`
tasks:
  - title: task-with-overrides
    completed: false
    model: claude-opus-4-5
    engine_args:
      - --temperature
      - "0"
`);

		const source = new YamlTaskSource(filePath);
		const tasks = await source.getAllTasks();

		expect(tasks).toHaveLength(1);
		expect(tasks[0].model).toBe("claude-opus-4-5");
		expect(tasks[0].engineArgs).toEqual(["--temperature", "0"]);
	});

	it("preserves model and engine_args from getTasksInGroup", async () => {
		const filePath = writeTempYaml(`
tasks:
  - title: task-group
    completed: false
    parallel_group: 1
    model: gpt-4o
    engine_args:
      - --max-tokens
      - "2000"
`);

		const source = new YamlTaskSource(filePath);
		const tasks = await source.getTasksInGroup(1);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].model).toBe("gpt-4o");
		expect(tasks[0].engineArgs).toEqual(["--max-tokens", "2000"]);
	});

	it("returns undefined model and engineArgs when not set", async () => {
		const filePath = writeTempYaml(`
tasks:
  - title: plain-task
    completed: false
`);

		const source = new YamlTaskSource(filePath);
		const tasks = await source.getAllTasks();

		expect(tasks[0].model).toBeUndefined();
		expect(tasks[0].engineArgs).toBeUndefined();
	});

	it("preserves task.engine from getAllTasks", async () => {
		const filePath = writeTempYaml(`
tasks:
  - title: task-with-engine
    completed: false
    engine: copilot
`);

		const source = new YamlTaskSource(filePath);
		const tasks = await source.getAllTasks();

		expect(tasks[0].engine).toBe("copilot");
	});

	it("preserves task.engine from getTasksInGroup", async () => {
		const filePath = writeTempYaml(`
tasks:
  - title: group-engine-task
    completed: false
    parallel_group: 1
    engine: opencode
`);

		const source = new YamlTaskSource(filePath);
		const tasks = await source.getTasksInGroup(1);

		expect(tasks[0].engine).toBe("opencode");
	});

	it("returns undefined engine when not set on task", async () => {
		const filePath = writeTempYaml(`
tasks:
  - title: no-engine
    completed: false
`);

		const source = new YamlTaskSource(filePath);
		const tasks = await source.getAllTasks();

		expect(tasks[0].engine).toBeUndefined();
	});

	it("preserves defaults.engine, model, and engine_args via getPrdDefaults", () => {
		const filePath = writeTempYaml(`
defaults:
  engine: opencode
  model: openai/gpt-5.5-mini
  engine_args:
    - --variant
    - low
tasks:
  - title: t1
    completed: false
`);

		const source = new YamlTaskSource(filePath);
		const defaults = source.getPrdDefaults();

		expect(defaults?.engine).toBe("opencode");
		expect(defaults?.model).toBe("openai/gpt-5.5-mini");
		expect(defaults?.engineArgs).toEqual(["--variant", "low"]);
	});

	it("returns undefined from getPrdDefaults when no defaults block", () => {
		const filePath = writeTempYaml(`
tasks:
  - title: t1
    completed: false
`);
		const source = new YamlTaskSource(filePath);
		expect(source.getPrdDefaults()).toBeUndefined();
	});
});
