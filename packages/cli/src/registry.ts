import type { OutputWriter } from "./output/protocol.js";
import { renderSuccess } from "./output/protocol.js";
import type { CliRuntime } from "./runtime/runtime.js";
import { CliError } from "./runtime/errors.js";
import { logLevels } from "./runtime/logger.js";

export interface CommandOption {
  name: string;
  description: string;
  required: boolean;
  values?: readonly string[];
}

export interface PositionalArgument {
  name: string;
  required: boolean;
  values?: readonly string[];
}

export interface CommandDefinition {
  usage: string;
  name: string;
  summary: string;
  positionals: readonly PositionalArgument[];
  options: readonly CommandOption[];
  resultSchema: object;
  errorCodes: readonly string[];
  exitCodes: readonly number[];
  handler: CommandHandler;
}

export interface CommandInvocation {
  options: Readonly<Record<string, unknown>>;
  positionals: readonly string[];
  runtime: CliRuntime;
}

export type CommandHandler = (
  output: OutputWriter,
  invocation: CommandInvocation,
) => void | Promise<void>;

const globalOptions: readonly CommandOption[] = [
  {
    name: "--config <path>",
    description: "Read configuration from an explicit local file.",
    required: false,
  },
  {
    name: "--log-level <level>",
    description: "Set stderr log verbosity.",
    required: false,
    values: logLevels,
  },
];

const configPathErrorCodes = [
  "usage.invalid",
  "runtime.unexpected",
  "config.path_invalid",
] as const;

export const commandRegistry: CommandDefinition[] = [
  {
    usage: "describe [command]",
    name: "describe",
    summary: "Return machine-readable command capabilities.",
    positionals: [{ name: "command", required: false }],
    options: globalOptions,
    resultSchema: { type: "object" },
    errorCodes: configPathErrorCodes,
    exitCodes: [0, 2],
    handler: (output, invocation) => {
      const description = describeCommand(invocation.positionals[0]);
      if (description === undefined) {
        throw new CliError("usage.invalid", "The command invocation is invalid.");
      }
      renderSuccess(output, "describe", description);
    },
  },
  {
    usage: "config",
    name: "config",
    summary: "Inspect read-only local CLI configuration.",
    positionals: [],
    options: globalOptions,
    resultSchema: { type: "object" },
    errorCodes: configPathErrorCodes,
    exitCodes: [0, 2],
    handler: (output) => renderSuccess(output, "describe", describeCommand("config")),
  },
  {
    usage: "config path",
    name: "config.path",
    summary: "Return the resolved local configuration path and source.",
    positionals: [],
    options: globalOptions,
    resultSchema: { type: "object", required: ["path", "source"] },
    errorCodes: configPathErrorCodes,
    exitCodes: [0, 2],
    handler: (output, invocation) => {
      renderSuccess(output, "config.path", {
        path: invocation.runtime.configPath,
        source: invocation.runtime.configSource,
      });
    },
  },
  {
    usage: "config show",
    name: "config.show",
    summary: "Return validated local configuration and its source.",
    positionals: [],
    options: globalOptions,
    resultSchema: { type: "object", required: ["configuration", "source"] },
    errorCodes: [
      ...configPathErrorCodes,
      "config.unreadable",
      "config.invalid_json",
      "config.unknown_field",
      "config.unsupported_version",
      "config.too_large",
    ],
    exitCodes: [0, 2],
    handler: async (output, invocation) => {
      const loaded = await invocation.runtime.loadConfig();
      invocation.runtime.logger.log("info", "Loaded local CLI configuration.");
      renderSuccess(output, "config.show", {
        configuration: loaded.configuration,
        source: loaded.source,
      });
    },
  },
];

export const rootCommand: CommandDefinition = {
  usage: "lore",
  name: "lore",
  summary: "Engineering knowledge tooling for AI coding agents.",
  positionals: [],
  options: globalOptions,
  resultSchema: { type: "object", required: ["name", "summary", "commands"] },
  errorCodes: configPathErrorCodes,
  exitCodes: [0, 2],
  handler: (output) => renderSuccess(output, "describe", describeCommand()),
};

export type KnownCommand = "lore" | (typeof commandRegistry)[number]["name"];

export function describeCommand(command?: string): object | undefined {
  if (command === "lore" || command === undefined) {
    return {
      ...rootCommand,
      commands: commandRegistry.map(materializeCommandDefinition),
    };
  }

  const definition = commandRegistry.find((candidate) => candidate.name === command);
  return definition === undefined ? undefined : materializeCommandDefinition(definition);
}

export interface Invocation {
  command: KnownCommand | "unknown";
  configPath: string | undefined;
  help: boolean;
  valid: boolean;
  version: boolean;
}

export function inspectInvocation(arguments_: readonly string[]): Invocation {
  const positionals: string[] = [];
  const suppliedOptions: ParsedOption[] = [];
  let help = false;
  let version = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) continue;

    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--version" || argument === "-V") {
      version = true;
      continue;
    }
    if (argument.startsWith("--")) {
      const parsedOption = parseOption(argument, arguments_[index + 1]);
      if (parsedOption === undefined) {
        return invalidInvocation("unknown", help, version, configPathFrom(suppliedOptions));
      }
      if (parsedOption.consumeNext) index += 1;
      suppliedOptions.push(parsedOption.option);
      continue;
    }
    if (argument.startsWith("-")) {
      return invalidInvocation(
        commandFromPositionals(positionals),
        help,
        version,
        configPathFrom(suppliedOptions),
      );
    }
    positionals.push(argument);
  }

  const configPath = configPathFrom(suppliedOptions);
  if (help && version)
    return invalidInvocation(commandFromPositionals(positionals), help, version, configPath);

  const command = commandFromPositionals(positionals);
  if (command === "unknown") return invalidInvocation(command, help, version, configPath);

  const definition = command === "lore" ? rootCommand : findCommand(command);
  if (
    definition === undefined ||
    !hasValidPositionals(
      materializeCommandDefinition(definition),
      positionals.slice(commandTokenCount(command)),
    )
  ) {
    return invalidInvocation(command, help, version, configPath);
  }

  if (version && command !== "lore") return invalidInvocation(command, help, version, configPath);
  if (!hasAllowedOptions(definition, suppliedOptions))
    return invalidInvocation(command, help, version, configPath);
  if (!help && !hasRequiredOptions(definition, suppliedOptions))
    return invalidInvocation(command, help, version, configPath);

  return { command, configPath, help, valid: true, version };
}

function invalidInvocation(
  command: KnownCommand | "unknown",
  help: boolean,
  version: boolean,
  configPath: string | undefined,
): Invocation {
  return { command, configPath, help, valid: false, version };
}

interface OptionSpec {
  flag: string;
  takesValue: boolean;
  values?: readonly string[];
}

interface ParsedOption {
  option: OptionSpec;
  value?: string;
}

function commandFromPositionals(positionals: readonly string[]): KnownCommand | "unknown" {
  if (positionals.length === 0) return "lore";

  for (let length = positionals.length; length > 0; length -= 1) {
    const definition = findCommand(positionals.slice(0, length).join("."));
    if (definition !== undefined) return definition.name;
  }
  return "unknown";
}

function commandTokenCount(command: KnownCommand): number {
  return command === "lore" ? 0 : command.split(".").length;
}

function findCommand(name: string): CommandDefinition | undefined {
  return commandRegistry.find((candidate) => candidate.name === name);
}

function materializeCommandDefinition(definition: CommandDefinition): CommandDefinition {
  if (definition.name !== "describe") return definition;

  return {
    ...definition,
    positionals: definition.positionals.map((positional) =>
      positional.name === "command"
        ? { ...positional, values: commandRegistry.map((candidate) => candidate.name) }
        : positional,
    ),
  };
}

function parseOption(
  argument: string,
  nextArgument: string | undefined,
): { consumeNext: boolean; option: ParsedOption } | undefined {
  const equalIndex = argument.indexOf("=");
  const flag = equalIndex === -1 ? argument : argument.slice(0, equalIndex);
  const option = allOptionSpecs().find((candidate) => candidate.flag === flag);
  if (option === undefined) return undefined;

  const value = equalIndex === -1 ? nextArgument : argument.slice(equalIndex + 1);
  if (!option.takesValue)
    return equalIndex === -1 ? { consumeNext: false, option: { option } } : undefined;
  if (value === undefined || value.startsWith("-") || !hasAllowedValue(option, value))
    return undefined;

  return { consumeNext: equalIndex === -1, option: { option, value } };
}

function configPathFrom(options: readonly ParsedOption[]): string | undefined {
  return options.filter((option) => option.option.flag === "--config").at(-1)?.value;
}

function hasValidPositionals(
  definition: CommandDefinition,
  positionals: readonly string[],
): boolean {
  if (positionals.length > definition.positionals.length) return false;

  return definition.positionals.every((positional, index) => {
    const value = positionals[index];
    if (value === undefined) return !positional.required;
    return positional.values === undefined || positional.values.includes(value);
  });
}

function hasAllowedOptions(
  definition: CommandDefinition,
  options: readonly ParsedOption[],
): boolean {
  const allowed = new Set(
    [...rootCommand.options, ...definition.options].map(toOptionSpec).map((option) => option.flag),
  );
  return options.every((option) => allowed.has(option.option.flag));
}

function hasRequiredOptions(
  definition: CommandDefinition,
  options: readonly ParsedOption[],
): boolean {
  const suppliedFlags = new Set(options.map((option) => option.option.flag));
  return [...rootCommand.options, ...definition.options]
    .filter((option) => option.required)
    .map(toOptionSpec)
    .every((option) => suppliedFlags.has(option.flag));
}

function allOptionSpecs(): OptionSpec[] {
  const options = [
    ...rootCommand.options,
    ...commandRegistry.flatMap((definition) => definition.options),
  ].map(toOptionSpec);
  return options.filter(
    (option, index) => options.findIndex((candidate) => candidate.flag === option.flag) === index,
  );
}

function toOptionSpec(option: CommandOption): OptionSpec {
  const [flag] = option.name.split(" ");
  return {
    flag: flag!,
    takesValue: option.name.includes("<"),
    ...(option.values === undefined ? {} : { values: option.values }),
  };
}

function hasAllowedValue(option: OptionSpec, value: string): boolean {
  return option.values === undefined || option.values.includes(value);
}
