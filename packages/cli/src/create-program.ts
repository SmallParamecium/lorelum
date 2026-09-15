import { Argument, Command, Option } from "commander";

import {
  assertJsonValue,
  renderSuccess,
  renderTextSuccess,
  type JsonValue,
  type OutputWriter,
} from "./output/protocol.js";
import {
  commandOptionAppliesTo,
  commandOptionKey,
  commandOptionDeclaration,
  commandRegistry,
  describeCommand,
  discoveryCommandName,
  positionalValues,
  requireCommandDescription,
  type CommandOption,
  type CommandDefinition,
  type DescribeCommand,
  type OutputFormat,
  rootCommand,
  snapshotCommandDefinitions,
} from "./registry.js";
import { renderHelpText } from "./output/help-renderer.js";
import { invalidInvocationError } from "./runtime/errors.js";
import { Logger, logLevels, type LogLevel } from "./runtime/logger.js";

export interface CliRuntime {
  /** Runtime capabilities are constructed before Commander parses an invocation. */
  readonly logger: Logger;
}

/** Internal callbacks that let `run` own selected-command and process-exit state. */
export interface ProgramLifecycle {
  selectCommand(definition: CommandDefinition): void;
  setExitCode(code: 1): void;
}

/** Builds a parser from one complete registry snapshot; `run` owns failure rendering. */
export function createProgram(
  runtime: CliRuntime,
  output: OutputWriter,
  lifecycle: ProgramLifecycle,
  registryDefinitions: readonly CommandDefinition[] = commandRegistry,
  outputFormat: OutputFormat = "json",
): Command {
  const registry = snapshotCommandDefinitions(registryDefinitions);
  const describeFromRegistry: DescribeCommand = (command) => describeCommand(command, registry);
  const program = new Command();

  program
    .name(rootCommand.name)
    .description(rootCommand.summary)
    .helpOption(false)
    .helpCommand(false)
    .configureOutput({ writeErr: () => undefined, writeOut: () => undefined })
    .exitOverride()
    .hook("preAction", () => {
      runtime.logger.setLevel(parsedLogLevel(program));
    })
    .action(() =>
      executeCommand(
        rootCommand,
        program,
        [],
        output,
        lifecycle,
        describeFromRegistry,
        discoveryCommandName,
        outputFormat,
      ),
    );

  for (const option of rootCommand.options) {
    program.addOption(toCommanderOption(option));
  }

  const helpCommand = program.command("help [command...]").helpOption(false).helpCommand(false);
  helpCommand.description("Show human-readable help for Lorelum commands.");
  helpCommand.action((...arguments_: unknown[]) => {
    const path = arguments_[0];
    const pathSegments = Array.isArray(path)
      ? path.filter((segment): segment is string => typeof segment === "string")
      : typeof path === "string"
        ? [path]
        : [];
    const command = arguments_.at(-1);
    if (!(command instanceof Command))
      throw new Error("Commander did not provide the Help context.");
    renderHelpPath(output, pathSegments, command, describeFromRegistry);
  });

  const commands = new Map<string, Command>();
  for (const definition of registry) {
    const command = commandForDefinition(program, commands, definition);
    command.description(definition.summary);
    for (const positional of definition.positionals) {
      const argument = new Argument(
        positional.required ? `<${positional.name}>` : `[${positional.name}]`,
      );
      // Let command-level Help reach the action without a required value. The registry
      // remains authoritative for usage text and required-argument validation below.
      if (positional.required) argument.argOptional();
      const values = positionalValues(definition, positional, registry);
      if (values !== undefined) argument.choices([...values]);
      command.addArgument(argument);
    }
    for (const option of definition.options) {
      command.addOption(toCommanderOption(option));
    }
    command.action(async (...arguments_: unknown[]) => {
      const commandInstance = arguments_.at(-1);
      if (!(commandInstance instanceof Command)) {
        throw new Error("Commander did not provide the command context.");
      }
      await executeCommand(
        definition,
        commandInstance,
        arguments_
          .slice(0, -1)
          .map((argument) => (typeof argument === "string" ? argument : undefined)),
        output,
        lifecycle,
        describeFromRegistry,
        definition.name,
        outputFormat,
      );
    });
  }

  for (const [path, command] of commands) {
    const isCommandGroup =
      !registry.some((definition) => definition.name === path) &&
      registry.some((definition) => definition.name.startsWith(`${path}.`));
    if (!isCommandGroup) continue;
    command.action(() => {
      const helpOption = frameworkOption("help");
      if (command.optsWithGlobals()[commandOptionKey(helpOption)] !== true) {
        throw invalidInvocationError();
      }
      renderHelpPath(output, path.split("."), command, describeFromRegistry);
    });
  }

  return program;
}

async function executeCommand(
  definition: CommandDefinition,
  command: Command,
  positionals: (string | undefined)[],
  output: OutputWriter,
  lifecycle: ProgramLifecycle,
  describeFromRegistry: DescribeCommand,
  responseCommand: string,
  outputFormat: OutputFormat,
): Promise<void> {
  lifecycle.selectCommand(definition);
  const helpOption = enabledFrameworkOption(command, definition, "help");
  const versionOption = enabledFrameworkOption(command, definition, "version");

  if (helpOption !== undefined && versionOption !== undefined) {
    throw invalidInvocationError();
  }
  if (versionOption !== undefined) {
    const response = versionOption.response;
    if (response === undefined) throw new Error("The version registry response is missing.");
    renderResponse(
      output,
      {
        command: response.command,
        data: response.data,
        ...(response.textRenderer === undefined ? {} : { textRenderer: response.textRenderer }),
      },
      outputFormat,
      `Static response "${response.command}" selected text without a renderer.`,
    );
    return;
  }
  if (helpOption !== undefined) {
    const description = requireCommandDescription(describeFromRegistry, definition.name);
    renderTextSuccess(output, renderHelpText(description));
    return;
  }
  for (const [index, positional] of definition.positionals.entries()) {
    if (positional.required && positionals[index] === undefined) {
      throw invalidInvocationError();
    }
  }
  for (const option of definition.options) {
    if (option.optionRequired && !hasParsedOption(command, option)) {
      throw invalidInvocationError();
    }
  }

  const result = await definition.handler({
    options: command.optsWithGlobals(),
    positionals: positionals.filter((positional): positional is string => positional !== undefined),
    describeCommand: describeFromRegistry,
  });
  const exitCode = result.exitCode ?? 0;
  if (!definition.exitCodes.includes(exitCode)) {
    throw new Error(`Command "${definition.name}" returned undeclared exit code ${exitCode}.`);
  }
  renderResponse(
    output,
    {
      command: responseCommand,
      data: result.data,
      ...(definition.textRenderer === undefined ? {} : { textRenderer: definition.textRenderer }),
      ...(definition.textOutputMode === undefined
        ? {}
        : { textOutputMode: definition.textOutputMode }),
    },
    outputFormat,
    `Command "${definition.name}" selected text without a renderer.`,
  );
  if (exitCode === 1) lifecycle.setExitCode(1);
}

interface RenderableResponse {
  readonly command: string;
  readonly data: JsonValue;
  readonly textRenderer?: NonNullable<CommandDefinition["textRenderer"]>;
  readonly textOutputMode?: CommandDefinition["textOutputMode"];
}

function renderResponse(
  output: OutputWriter,
  response: RenderableResponse,
  format: OutputFormat,
  missingTextRendererMessage: string,
): void {
  assertJsonValue(response.data);
  if (format === "json") {
    renderSuccess(output, response.command, response.data);
    return;
  }
  if (response.textRenderer === undefined) {
    throw new Error(missingTextRendererMessage);
  }
  renderTextSuccess(
    output,
    response.textRenderer(response.data),
    response.textOutputMode ?? "line",
  );
}

function commandForDefinition(
  program: Command,
  commands: Map<string, Command>,
  definition: CommandDefinition,
): Command {
  const segments = definition.name.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    throw new Error(`Invalid command name: ${definition.name}`);
  }

  let parent = program;
  for (let index = 0; index < segments.length; index += 1) {
    const path = segments.slice(0, index + 1).join(".");
    let command = commands.get(path);
    if (command === undefined) {
      command = parent.command(segments[index]!).helpOption(false).helpCommand(false);
      commands.set(path, command);
    }
    parent = command;
  }
  return parent;
}

function renderHelpPath(
  output: OutputWriter,
  pathSegments: readonly string[],
  command: Command,
  describe: DescribeCommand,
): void {
  const versionOption = frameworkOption("version");
  if (command.optsWithGlobals()[commandOptionKey(versionOption)] === true) {
    throw invalidInvocationError();
  }
  const description = resolveHelpDescription(pathSegments, describe);
  if (description === undefined) throw invalidInvocationError();
  renderTextSuccess(output, renderHelpText(description));
}

function resolveHelpDescription(
  pathSegments: readonly string[],
  describe: DescribeCommand,
): JsonValue | undefined {
  if (pathSegments.length === 0) {
    return requireCommandDescription(describe);
  }
  const path = pathSegments.join(".");
  const direct = describe(path);
  if (direct !== undefined) return direct;

  const root = describe();
  if (typeof root !== "object" || root === null || Array.isArray(root) || !("commands" in root)) {
    return undefined;
  }
  const commands = root.commands;
  if (!Array.isArray(commands)) return undefined;
  const children = commands.filter(
    (candidate) =>
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate) &&
      "name" in candidate &&
      typeof candidate.name === "string" &&
      candidate.name.startsWith(`${path}.`),
  );
  if (children.length === 0) return undefined;
  return {
    name: path,
    summary: `Commands under ${path.replaceAll(".", " ")}`,
    usage: path.replaceAll(".", " "),
    positionals: [],
    options: [],
    commands: children,
  };
}

function hasParsedOption(command: Command, option: CommandDefinition["options"][number]): boolean {
  const key = commandOptionKey(option);
  return command.optsWithGlobals()[key] !== undefined;
}

function toCommanderOption(option: CommandDefinition["options"][number]): Option {
  const commanderOption = new Option(commandOptionDeclaration(option), option.description);
  if (option.values !== undefined) commanderOption.choices([...option.values]);
  if (option.defaultValue !== undefined) commanderOption.default(option.defaultValue);
  return commanderOption;
}

function frameworkOption(behavior: NonNullable<CommandOption["behavior"]>): CommandOption {
  const option = rootCommand.options.find((candidate) => candidate.behavior === behavior);
  if (option === undefined) throw new Error(`The ${behavior} registry option is missing.`);
  return option;
}

function enabledFrameworkOption(
  command: Command,
  definition: CommandDefinition,
  behavior: NonNullable<CommandOption["behavior"]>,
): CommandOption | undefined {
  const option = frameworkOption(behavior);
  if (command.optsWithGlobals()[commandOptionKey(option)] !== true) return undefined;
  if (!commandOptionAppliesTo(option, definition)) throw invalidInvocationError();
  return option;
}

function parsedLogLevel(command: Command): LogLevel {
  const option = frameworkOption("log-level");
  const value = command.optsWithGlobals()[commandOptionKey(option)];
  if (typeof value !== "string" || !logLevels.includes(value as LogLevel)) {
    throw new Error("The log-level registry option is missing or invalid.");
  }
  return value as LogLevel;
}
