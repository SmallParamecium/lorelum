import { expect, test } from "bun:test";
import assert from "node:assert/strict";

import { ProcessTimeoutError, runProcess } from "./process.js";

const bunExecutable = Bun.which("bun");
if (bunExecutable === null) throw new Error("Bun executable is required for process tests.");

test("collects a completed process result", async () => {
  await expect(runProcess([bunExecutable, "-e", "console.log('ok')"])).resolves.toEqual({
    exitCode: 0,
    stderr: "",
    stdout: "ok\n",
  });
});

test("terminates a timed-out process before rejecting", async () => {
  try {
    await runProcess(
      [bunExecutable, "-e", "console.log('started'); setInterval(() => undefined, 1_000);"],
      100,
    );
    assert.fail("expected the child process to time out");
  } catch (error) {
    assert(error instanceof ProcessTimeoutError);
    assert.match(error.message, /stdout:\nstarted\n/);
  }
});
