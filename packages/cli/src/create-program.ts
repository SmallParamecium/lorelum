import { Command, Option } from "commander";

import type { OutputWriter } from "./output/protocol.js";
import { commandRegistry, type CommandDefinition, rootCommand } from "./registry.js";
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
      rootCommand.handler(output, { options: program.opts(), positionals: [] });
    });

  for (const definition of commandRegistry) {
    const command = program.command(definition.usage).description(definition.summary);
    for (const option of commandSpecificOptions(definition)) {
      command.addOption(toCommanderOption(option));
    }
    command.action((...arguments_: unknown[]) => {
      const commandInstance = arguments_.at(-1);
      if (!(commandInstance instanceof Command)) {
        throw new Error("Commander did not provide the command context.");
      }
      definition.handler(output, {
        options: { ...program.opts(), ...commandInstance.opts() },
        positionals: arguments_
          .slice(0, -1)
          .filter((argument): argument is string => typeof argument === "string"),
      });
    });
  }

  return program;
}

function commandSpecificOptions(definition: CommandDefinition) {
  const globalOptionNames = new Set(rootCommand.options.map((option) => option.name));
  return definition.options.filter((option) => !globalOptionNames.has(option.name));
}

function toCommanderOption(option: CommandDefinition["options"][number]): Option {
  const commanderOption = new Option(option.name, option.description);
  if (option.required) commanderOption.makeOptionMandatory();
  if (option.values !== undefined) commanderOption.choices([...option.values]);
  return commanderOption;
}
