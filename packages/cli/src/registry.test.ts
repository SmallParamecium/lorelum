import { expect, test } from "bun:test";

import type { CommandDefinition } from "./registry.js";
import { run } from "./main.js";
import { renderSuccess } from "./output/protocol.js";
import { commandRegistry, describeCommand, inspectInvocation } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

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

test("derives invocation validation, parser options, and describe metadata from registered commands", async () => {
  const futureCommand: CommandDefinition = {
    usage: "future",
    name: "future",
    summary: "Temporary registry regression command.",
    positionals: [],
    options: [
      {
        name: "--future-mode <mode>",
        description: "Exercise command-specific option registration.",
        required: true,
        values: ["safe"],
      },
    ],
    resultSchema: { type: "object" },
    errorCodes: [],
    exitCodes: [0],
    handler: (output, invocation) => {
      renderSuccess(output, "future", { mode: invocation.options.futureMode });
    },
  };
  commandRegistry.push(futureCommand);

  try {
    expect(inspectInvocation(["future"])).toMatchObject({ command: "future", valid: false });
    expect(inspectInvocation(["future", "--future-mode", "safe"])).toMatchObject({
      command: "future",
      valid: true,
    });
    expect(inspectInvocation(["future", "--future-mode", "unsafe"])).toMatchObject({
      valid: false,
    });
    expect(inspectInvocation(["future", "--help"])).toMatchObject({
      command: "future",
      help: true,
      valid: true,
    });
    expect(describeCommand("future")).toMatchObject({ name: "future" });
    expect(describeCommand("describe")).toMatchObject({
      positionals: [{ name: "command", values: ["describe", "future"] }],
    });

    const stdout = new MemoryWriter();
    expect(await run(["future", "--future-mode", "safe"], { stdout })).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({ command: "future", data: { mode: "safe" } });

    const missingRequiredOption = new MemoryWriter();
    expect(await run(["future"], { stdout: missingRequiredOption })).toBe(2);
  } finally {
    commandRegistry.pop();
  }
});
