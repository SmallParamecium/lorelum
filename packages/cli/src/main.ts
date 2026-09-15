#!/usr/bin/env bun

import { hasDaemonLaunchEnvironment } from "@lorelum/backend/config";
import { createProgram, type CliRuntime } from "./create-program.js";
import {
  parseCodexHookInvocation,
  runCodexHook,
  type CodexHookServices,
  type TextInput,
} from "./hook/codex.js";
import { renderFailure, renderTextFailure, type OutputWriter } from "./output/protocol.js";
import { resolveOutputFormat } from "./output/format-selection.js";
import {
  commandRegistry,
  rootCommand,
  type CommandDefinition,
  type KnownCommand,
  type OutputFormat,
} from "./registry.js";
import { toVisibleCliError } from "./runtime/errors.js";
import { Logger } from "./runtime/logger.js";

export interface RunOptions {
  /** Complete registry replacement; omit to use the immutable built-in `commandRegistry`. */
  registry?: readonly CommandDefinition[];
  /** Prebuilt runtime override; omit to use the process stderr-backed runtime. */
  runtime?: CliRuntime;
  /** Override the raw Codex Hook input stream in source-level tests. */
  stdin?: TextInput;
  /** Override the raw Codex Hook Store adapter in source-level tests. */
  codexHookServices?: CodexHookServices;
  stderr?: OutputWriter;
  stdout?: OutputWriter;
}

/** Executes one argv invocation and owns its single protocol response and exit code. */
export async function run(arguments_: string[], options: RunOptions = {}): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const codexHook = parseCodexHookInvocation(arguments_);
  if (codexHook !== undefined) {
    return runCodexHook({
      stdin: options.stdin ?? standardInput,
      stdout,
      stderr,
      ...(options.codexHookServices === undefined ? {} : { services: options.codexHookServices }),
      ...(codexHook.storeRoot === undefined ? {} : { storeRoot: codexHook.storeRoot }),
    });
  }
  let command: KnownCommand | "unknown" = "unknown";
  let commandExitCode: 0 | 1 = 0;
  let outputFormat: OutputFormat = "json";
  let visibleErrorCodes = rootCommand.errorCodes;

  try {
    const definitions = options.registry ?? commandRegistry;
    const formatSelection = resolveOutputFormat(arguments_, definitions);
    if (
      formatSelection.definition !== rootCommand ||
      formatSelection.response !== undefined ||
      formatSelection.error !== undefined
    ) {
      command = formatSelection.commandName as KnownCommand | "unknown";
    }
    outputFormat = formatSelection.format;
    visibleErrorCodes = formatSelection.definition?.errorCodes ?? rootCommand.errorCodes;
    if (formatSelection.error !== undefined) throw formatSelection.error;

    const runtime = options.runtime ?? { logger: new Logger(stderr) };
    const program = createProgram(
      runtime,
      stdout,
      {
        selectCommand(definition) {
          command = definition.name as KnownCommand;
          visibleErrorCodes = definition.errorCodes;
        },
        setExitCode(exitCode) {
          commandExitCode = exitCode;
        },
      },
      options.registry,
      outputFormat,
    );
    await program.parseAsync(arguments_, { from: "user" });
    return commandExitCode;
  } catch (error) {
    const cliError = toVisibleCliError(error, visibleErrorCodes);
    if (outputFormat === "text") {
      renderTextFailure(stderr, cliError.code, cliError.message);
    } else {
      renderFailure(stdout, command, cliError.code, cliError.message);
    }
    return cliError.exitCode;
  }
}

const standardInput: TextInput = {
  text: () => Bun.stdin.text(),
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (isInternalBackendDaemonLaunch(args)) {
    const { currentBuildIdentity } = await import("@lorelum/backend/control");
    const { runBackendDaemon } = await import("@lorelum/backend/daemon");
    await runBackendDaemon({ buildIdentity: await currentBuildIdentity(import.meta.path) });
  } else {
    process.exitCode = await run(args);
  }
}

export function isInternalBackendServeInvocation(args: readonly string[]): boolean {
  return args.length === 1 && args[0] === "--internal-backend-serve";
}
export function isInternalBackendDaemonLaunch(
  args: readonly string[],
  environment?: Readonly<Record<string, string | undefined>>,
): boolean {
  return isInternalBackendServeInvocation(args) && hasDaemonLaunchEnvironment(environment);
}
