import { describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonTaskSource } from "./json.ts";

describe("JsonTaskSource model and engine_args", () => {
	function writeTempJson(content: object): string {
		const dir = mkdtempSync(join(tmpdir(), "ralphy-json-test-"));
		const filePath = join(dir, "tasks.json");
		writeFileSync(filePath, JSON.stringify(content), "utf-8");
		return filePath;
	}

	it("preserves model and engine_args from getAllTasks", async () => {
		const filePath = writeTempJson({
			tasks: [
				{
					title: "task-with-overrides",
					completed: false,
					model: "claude-opus-4-5",
					engine_args: ["--temperature", "0"],
				},
			],
		});

		const source = new JsonTaskSource(filePath);
		const tasks = await source.getAllTasks();

		expect(tasks).toHaveLength(1);
		expect(tasks[0].model).toBe("claude-opus-4-5");
		expect(tasks[0].engineArgs).toEqual(["--temperature", "0"]);
	});

	it("preserves model and engine_args from getTasksInGroup", async () => {
		const filePath = writeTempJson({
			tasks: [
				{
					title: "task-group",
					completed: false,
					parallel_group: 1,
					model: "gpt-4o",
					engine_args: ["--max-tokens", "2000"],
				},
			],
		});

		const source = new JsonTaskSource(filePath);
		const tasks = await source.getTasksInGroup(1);

		expect(tasks).toHaveLength(1);
		expect(tasks[0].model).toBe("gpt-4o");
		expect(tasks[0].engineArgs).toEqual(["--max-tokens", "2000"]);
	});

	it("returns undefined model and engineArgs when not set", async () => {
		const filePath = writeTempJson({
			tasks: [{ title: "plain-task", completed: false }],
		});

		const source = new JsonTaskSource(filePath);
		const tasks = await source.getAllTasks();

		expect(tasks[0].model).toBeUndefined();
		expect(tasks[0].engineArgs).toBeUndefined();
	});
});
