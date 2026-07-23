#!/usr/bin/env bun

import { createProgram, type CliRuntime } from "./create-program.js";
import { renderFailure, renderSuccess, toolVersion, type OutputWriter } from "./output/protocol.js";
import { describeCommand, inspectInvocation } from "./registry.js";
import { toCliError } from "./runtime/errors.js";
import { Logger } from "./runtime/logger.js";

export interface RunOptions {
  runtime?: CliRuntime;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

export async function run(arguments_: string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const invocation = inspectInvocation(arguments_);

  try {
    if (!invocation.valid) {
      throw new Error("invalid invocation");
    }

    if (invocation.help) {
      const command = invocation.command === "unknown" ? undefined : invocation.command;
      renderSuccess(stdout, "describe", describeCommand(command));
      return 0;
    }

    if (invocation.version) {
      renderSuccess(stdout, "version", { protocolVersion: 1, toolVersion });
      return 0;
    }

    const runtime = options.runtime ?? { logger: new Logger(stderr) };
    const program = createProgram(runtime, stdout);
    await program.parseAsync(arguments_, { from: "user" });
    return 0;
  } catch (error) {
    const cliError = invocation.valid ? toCliError(error) : toUsageError();
    renderFailure(stdout, invocation.command, cliError.code, cliError.message);
    return cliError.exitCode;
  }
}

function toUsageError() {
  return {
    code: "usage.invalid",
    exitCode: 2 as const,
    message: "The command invocation is invalid.",
  };
}

if (import.meta.main) {
  process.exitCode = await run(process.argv.slice(2));
}
