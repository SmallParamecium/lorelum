import { platformEnvironment } from "../config/launch";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BackendError } from "../protocol/errors";
const execute = promisify(execFile);
export interface ProcessIdentity {
  readonly pid: number;
  readonly startedAt: string;
}

export async function processIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  if (process.platform === "win32") {
    // Loaded lazily so POSIX hosts never resolve kernel32.
    const { windowsProcessStartTime } = await import("./windows-process");
    const startedAt = windowsProcessStartTime(pid);
    return startedAt === undefined ? undefined : { pid, startedAt };
  }
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ESRCH")
      return undefined;
    throw new BackendError("backend.state-invalid", { cause: error });
  }
  try {
    const { stdout } = await execute("ps", ["-o", "lstart=", "-o", "stat=", "-p", String(pid)], {
      timeout: 2_000,
      env: { ...platformEnvironment(), LC_ALL: "C" },
    });
    const line = stdout.trim();
    const status = line.split(/\s+/).at(-1);
    const startedAt = status === undefined ? "" : line.slice(0, -status.length).trim();
    if (!startedAt || !status) throw new BackendError("backend.state-invalid");
    // A zombie still answers signal 0 but has already exited and cannot own Backend work.
    if (status.startsWith("Z")) return undefined;
    return { pid, startedAt };
  } catch (error) {
    try {
      process.kill(pid, 0);
    } catch (probe) {
      if (probe !== null && typeof probe === "object" && "code" in probe && probe.code === "ESRCH")
        return undefined;
    }
    throw new BackendError("backend.state-invalid", { cause: error });
  }
}
export async function isSameProcess(expected: ProcessIdentity): Promise<boolean> {
  const actual = await processIdentity(expected.pid);
  return actual !== undefined && actual.startedAt === expected.startedAt;
}

/** A recorded native child is recoverable only while it remains owned by the verified daemon. */
export async function isDirectChildProcess(
  child: ProcessIdentity,
  parent: ProcessIdentity,
): Promise<boolean> {
  if (!(await isSameProcess(child)) || !(await isSameProcess(parent))) return false;
  const parentPid = await processParentPid(child.pid);
  return parentPid === parent.pid && (await isSameProcess(child)) && (await isSameProcess(parent));
}

async function processParentPid(pid: number): Promise<number | undefined> {
  if (process.platform === "win32") {
    // Loaded lazily so POSIX hosts never resolve kernel32 or ntdll.
    const { windowsProcessParentPid } = await import("./windows-process");
    return windowsProcessParentPid(pid);
  }
  try {
    const { stdout } = await execute("ps", ["-o", "ppid=", "-p", String(pid)], {
      timeout: 2_000,
      env: { ...platformEnvironment(), LC_ALL: "C" },
    });
    const parentPid = Number(stdout.trim());
    if (!Number.isSafeInteger(parentPid) || parentPid < 1)
      throw new BackendError("backend.state-invalid");
    return parentPid;
  } catch (error) {
    if ((await processIdentity(pid)) === undefined) return undefined;
    throw new BackendError("backend.state-invalid", { cause: error });
  }
}
