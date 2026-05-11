import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Mock } from "bun:test";
import * as loggerModule from "../ui/logger.ts";
import {
	formatEngineArgs,
	logResolvedTaskRouting,
	logTaskExecutionRecord,
} from "./task-execution-logging.ts";
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

describe("formatEngineArgs", () => {
	it('returns "(none)" for undefined', () => {
		expect(formatEngineArgs(undefined)).toBe("(none)");
	});

	it('returns "(none)" for empty array', () => {
		expect(formatEngineArgs([])).toBe("(none)");
	});

	it("joins args with spaces", () => {
		expect(formatEngineArgs(["--variant", "high"])).toBe("--variant high");
	});

	it("handles single arg", () => {
		expect(formatEngineArgs(["--fast"])).toBe("--fast");
	});

	it("preserves args with special characters", () => {
		expect(formatEngineArgs(["-c", 'model_reasoning_effort="high"'])).toBe(
			'-c model_reasoning_effort="high"',
		);
	});
});

describe("logResolvedTaskRouting", () => {
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

	it("logs Engine, Model, and Engine args for full routing", () => {
		logResolvedTaskRouting({
			engineName: "OpenCode",
			model: "deepseek/deepseek-v4-pro",
			engineArgs: ["--variant", "high"],
		});
		expect(lines).toContain("  Engine: OpenCode");
		expect(lines).toContain("  Model: deepseek/deepseek-v4-pro");
		expect(lines).toContain("  Engine args: --variant high");
	});

	it('logs "(none)" when engineArgs is undefined', () => {
		logResolvedTaskRouting({ engineName: "claude" });
		expect(lines).toContain("  Engine args: (none)");
	});

	it('logs "(none)" when engineArgs is empty array', () => {
		logResolvedTaskRouting({ engineName: "claude", engineArgs: [] });
		expect(lines).toContain("  Engine args: (none)");
	});

	it("skips Model line when model is undefined", () => {
		logResolvedTaskRouting({ engineName: "claude", engineArgs: ["--fast"] });
		expect(lines.some((l) => l.startsWith("  Model:"))).toBe(false);
		expect(lines).toContain("  Engine args: --fast");
	});

	it("logs Codex task-level override args", () => {
		logResolvedTaskRouting({
			engineName: "Codex",
			model: "gpt-5.5",
			engineArgs: ["-c", 'model_reasoning_effort="high"'],
		});
		expect(lines).toContain('  Engine args: -c model_reasoning_effort="high"');
	});
});
