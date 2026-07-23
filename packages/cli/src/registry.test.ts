import { expect, test } from "bun:test";

import { describeCommand, inspectInvocation } from "./registry.js";

test("describes registered commands from a single registry", () => {
  expect(describeCommand()).toMatchObject({
    name: "lore",
    commands: [
      {
        name: "describe",
        positionals: [{ name: "command", values: ["describe"] }],
      },
    ],
  });
});

test("validates commands and global options before special responses", () => {
  expect(inspectInvocation(["describe", "--help"])).toEqual({
    command: "describe",
    help: true,
    valid: true,
    version: false,
  });
  expect(inspectInvocation(["missing", "--help"])).toMatchObject({ valid: false });
  expect(inspectInvocation(["--log-level", "--version"])).toMatchObject({ valid: false });
});
