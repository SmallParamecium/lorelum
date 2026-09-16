import { dlopen, ptr } from "bun:ffi";
import { BackendError } from "../protocol/errors";

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_BASIC_INFORMATION = 0;

/**
 * kernel32 process-identity calls, resolved on first use. Importing this module must
 * stay inert on every platform; only windowsProcessStartTime under win32 opens the library.
 */
let kernel32Symbols: ReturnType<typeof loadKernel32Symbols> | undefined;
let ntdllSymbols: ReturnType<typeof loadNtdllSymbols> | undefined;

function loadKernel32Symbols() {
  return dlopen("kernel32.dll", {
    OpenProcess: {
      args: ["u32", "i32", "u32"],
      returns: "ptr",
    },
    GetProcessTimes: {
      args: ["ptr", "ptr", "ptr", "ptr", "ptr"],
      returns: "bool",
    },
    CloseHandle: { args: ["ptr"], returns: "bool" },
  }).symbols;
}

function loadNtdllSymbols() {
  return dlopen("ntdll.dll", {
    NtQueryInformationProcess: {
      args: ["ptr", "i32", "ptr", "u32", "ptr"],
      returns: "i32",
    },
  }).symbols;
}

/**
 * Return the process creation time as a FILETIME string for identity comparison, or
 * undefined when the process no longer exists. Lorelum daemons run as the current
 * user, so a null handle from OpenProcess is treated as "gone" rather than a failure.
 */
export function windowsProcessStartTime(pid: number): string | undefined {
  const symbols = (kernel32Symbols ??= loadKernel32Symbols());
  const handle = symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (handle === null) return undefined;
  try {
    const times = Buffer.alloc(32);
    const readable = symbols.GetProcessTimes(
      handle,
      ptr(times, 0),
      ptr(times, 8),
      ptr(times, 16),
      ptr(times, 24),
    );
    if (!readable) throw new BackendError("backend.state-invalid");
    return times.readBigUInt64LE(0).toString();
  } finally {
    symbols.CloseHandle(handle);
  }
}

/**
 * Return the direct parent PID from PROCESS_BASIC_INFORMATION. A missing process returns
 * undefined; an unreadable live process is a state-validation failure rather than ownership.
 */
export function windowsProcessParentPid(pid: number): number | undefined {
  const kernel32 = (kernel32Symbols ??= loadKernel32Symbols());
  const handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
  if (handle === null) return undefined;
  try {
    const size = process.arch === "ia32" ? 24 : 48;
    const basic = Buffer.alloc(size);
    const returned = Buffer.alloc(4);
    const status = (ntdllSymbols ??= loadNtdllSymbols()).NtQueryInformationProcess(
      handle,
      PROCESS_BASIC_INFORMATION,
      ptr(basic, 0),
      size,
      ptr(returned, 0),
    );
    if (status !== 0) throw new BackendError("backend.state-invalid");
    const parentPid =
      process.arch === "ia32" ? basic.readUInt32LE(20) : Number(basic.readBigUInt64LE(40));
    if (!Number.isSafeInteger(parentPid) || parentPid < 1)
      throw new BackendError("backend.state-invalid");
    return parentPid;
  } finally {
    kernel32.CloseHandle(handle);
  }
}
