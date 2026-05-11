import { spawnSync } from "node:child_process";

const isWindows = process.platform === "win32";

interface ActiveProcess {
	label: string;
	pid?: number;
	kill?: () => void;
}

let cancellationRequested = false;
const activeProcesses = new Set<ActiveProcess>();

export class CancellationError extends Error {
	constructor(message = "Cancelled by user") {
		super(message);
		this.name = "CancellationError";
	}
}

export function isCancellationError(error: unknown): boolean {
	return error instanceof CancellationError;
}

export function isCancellationRequested(): boolean {
	return cancellationRequested;
}

export function requestCancellation(): void {
	cancellationRequested = true;
	for (const activeProcess of activeProcesses) {
		terminateProcess(activeProcess);
	}
}

export function throwIfCancellationRequested(): void {
	if (cancellationRequested) {
		throw new CancellationError();
	}
}

export function registerActiveProcess(label: string, pid?: number, kill?: () => void): () => void {
	const activeProcess: ActiveProcess = { label, pid, kill };
	activeProcesses.add(activeProcess);

	if (cancellationRequested) {
		terminateProcess(activeProcess);
	}

	return () => {
		activeProcesses.delete(activeProcess);
	};
}

export function hasActiveProcesses(): boolean {
	return activeProcesses.size > 0;
}

export function resetCancellationForTests(): void {
	cancellationRequested = false;
	activeProcesses.clear();
}

function terminateProcess(activeProcess: ActiveProcess): void {
	if (activeProcess.pid && isWindows) {
		const result = spawnSync("taskkill", ["/PID", String(activeProcess.pid), "/T", "/F"], {
			stdio: "ignore",
			windowsHide: true,
		});

		if (result.status === 0) {
			return;
		}
	}

	try {
		activeProcess.kill?.();
	} catch {
		// Best effort. The caller will still observe cancellation state.
	}
}

let signalHandlersInstalled = false;
let escCount = 0;
let escResetTimer: ReturnType<typeof setTimeout> | null = null;

interface CancellationHandlerCallbacks {
	onFirstEsc?: () => void;
	onCancel?: (activeProcessCount: number) => void;
}

export function installCancellationHandlers(callbacks: CancellationHandlerCallbacks = {}): void {
	if (signalHandlersInstalled) return;
	signalHandlersInstalled = true;

	process.on("SIGINT", () => {
		callbacks.onCancel?.(activeProcesses.size);
		requestCancellation();

		if (!hasActiveProcesses()) {
			process.exitCode = 130;
		}
	});

	if (!process.stdin.isTTY) return;

	process.stdin.setRawMode(true);
	process.stdin.resume();
	process.stdin.on("data", (data: Buffer) => {
		const input = data.toString("utf-8");

		if (input === "\u0003") {
			callbacks.onCancel?.(activeProcesses.size);
			requestCancellation();

			if (!hasActiveProcesses()) {
				process.exitCode = 130;
			}
			return;
		}

		if (!input.includes("\u001b")) {
			return;
		}

		handleEscPress(callbacks);
	});
}

function handleEscPress(callbacks: CancellationHandlerCallbacks): void {
	if (cancellationRequested) {
		process.exit(130);
	}

	escCount++;
	if (escCount === 1) {
		callbacks.onFirstEsc?.();
		if (escResetTimer) {
			clearTimeout(escResetTimer);
		}
		escResetTimer = setTimeout(() => {
			escCount = 0;
			escResetTimer = null;
		}, 2000);
		return;
	}

	if (escResetTimer) {
		clearTimeout(escResetTimer);
		escResetTimer = null;
	}
	escCount = 0;

	callbacks.onCancel?.(activeProcesses.size);
	requestCancellation();

	if (!hasActiveProcesses()) {
		process.exitCode = 130;
	}
}
