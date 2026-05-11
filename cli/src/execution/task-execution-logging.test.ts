import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as loggerModule from "../ui/logger.ts";
import { logTaskExecutionRecord } from "./task-execution-logging.ts";
import type { TaskExecutionRecord } from "./task-execution-record.ts";

describe("logTaskExecutionRecord", () => {
	let lines: string[];
	let spy: Mock<typeof loggerModule.logInfo>;

	beforeEach(() => {
		lines = [];
		spy = spyOn(loggerModule, "logInfo").mockImplementation((msg: string) => {
			lines.push(msg);
		});
	});

	afterEach(() => {
		spy.mockRestore();
	});

	function captureLog(fn: () => void): string[] {
		lines = [];
		fn();
		return lines;
	}

	it("prints engine name for completed task", () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "My task",
			status: "completed",
			engineName: "claude",
			engineArgs: [],
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("claude"))).toBe(true);
		expect(lines.some((l) => l.includes("[Completed]"))).toBe(true);
	});

	it('shows "engine default" when no model is resolved', () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "No model task",
			status: "completed",
			engineName: "claude",
			engineArgs: [],
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("engine default"))).toBe(true);
	});

	it("shows resolved model when set", () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "Model task",
			status: "completed",
			engineName: "claude",
			model: "claude-opus-4-5",
			engineArgs: [],
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("claude-opus-4-5"))).toBe(true);
	});

	it('shows "(none)" when engineArgs is empty', () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "No args task",
			status: "completed",
			engineName: "claude",
			engineArgs: [],
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("(none)"))).toBe(true);
	});

	it("shows joined engine args when set", () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "Args task",
			status: "completed",
			engineName: "claude",
			engineArgs: ["--fast", "--stream"],
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("--fast --stream"))).toBe(true);
	});

	it("prints [Failed] label for failed tasks", () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "Failing task",
			status: "failed",
			engineName: "opencode",
			engineArgs: [],
			error: "some error",
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("[Failed]"))).toBe(true);
	});

	it("prints [Deferred] label for deferred tasks", () => {
		const rec: TaskExecutionRecord = {
			taskId: "1",
			taskTitle: "Rate limited task",
			status: "deferred",
			engineName: "claude",
			engineArgs: [],
		};
		const lines = captureLog(() => logTaskExecutionRecord(rec));
		expect(lines.some((l) => l.includes("[Deferred]"))).toBe(true);
	});
});
