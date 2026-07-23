import { expect, test } from "bun:test";

import { commandRegistry, describeCommand, inspectInvocation } from "./registry.js";

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

test("registers every command definition with an executable handler", () => {
  for (const command of commandRegistry) {
    expect(command.usage).toContain(command.name);
    expect(command.handler).toBeInstanceOf(Function);
  }
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
  expect(inspectInvocation(["--log-level=debug"])).toMatchObject({ valid: true });
  expect(inspectInvocation(["--log-level=verbose"])).toMatchObject({ valid: false });
});
