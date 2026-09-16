import { expect, test } from "bun:test";
import { spawn } from "node:child_process";

import { isDirectChildProcess, processIdentity } from "./process-identity";

test("direct-child verification binds a live process to its verified parent", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    if (child.pid === undefined) throw new Error("Test child did not receive a PID.");
    const identity = await processIdentity(child.pid);
    const parent = await processIdentity(process.pid);
    if (identity === undefined || parent === undefined)
      throw new Error("Live test processes must have stable identities.");
    expect(await isDirectChildProcess(identity, parent)).toBe(true);
    expect(await isDirectChildProcess(identity, identity)).toBe(false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("close", () => resolve()));
    }
  }
});
