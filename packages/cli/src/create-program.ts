import { Command, Option } from "commander";

import type { OutputWriter } from "./output/protocol.js";
import { commandRegistry, rootCommand } from "./registry.js";
import { Logger, logLevels, type LogLevel } from "./runtime/logger.js";

export interface CliRuntime {
  readonly logger: Logger;
}

export function createProgram(runtime: CliRuntime, output: OutputWriter): Command {
  const program = new Command();

  program
    .name("lore")
    .description("Engineering knowledge tooling for AI coding agents.")
    .helpOption(false)
    .helpCommand(false)
    .addOption(
      new Option("--log-level <level>", "Set stderr log verbosity.")
        .choices(logLevels)
        .default("error"),
    )
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .exitOverride()
    .hook("preAction", () => {
      runtime.logger.setLevel(program.opts<{ logLevel: LogLevel }>().logLevel);
    })
    .action(() => {
      rootCommand.handler(output);
    });

  for (const definition of commandRegistry) {
    program
      .command(definition.usage)
      .description(definition.summary)
      .action((target?: string) => {
        definition.handler(output, target);
      });
  }

  return program;
}
