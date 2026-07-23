import { CliError } from "./runtime/errors.js";
import { logLevels } from "./runtime/logger.js";
import { renderSuccess, type OutputWriter } from "./output/protocol.js";

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
}

export type CommandHandler = (output: OutputWriter, invocation: CommandInvocation) => void;

const globalOptions: readonly CommandOption[] = [
  {
    name: "--log-level <level>",
    description: "Set stderr log verbosity.",
    required: false,
    values: logLevels,
  },
] as const satisfies readonly CommandOption[];

export const commandRegistry: CommandDefinition[] = [
  {
    usage: "describe [command]",
    name: "describe",
    summary: "Return machine-readable command capabilities.",
    positionals: [
      {
        name: "command",
        required: false,
      },
    ],
    options: globalOptions,
    resultSchema: {
      type: "object",
      required: [
        "name",
        "summary",
        "positionals",
        "options",
        "resultSchema",
        "errorCodes",
        "exitCodes",
      ],
    },
    errorCodes: ["usage.invalid", "runtime.unexpected"],
    exitCodes: [0, 2],
    handler: (output, invocation) => {
      const description = describeCommand(invocation.positionals[0]);
      if (description === undefined) {
        throw new CliError("usage.invalid", "The command invocation is invalid.");
      }
      renderSuccess(output, "describe", description);
    },
  },
];

export const rootCommand: CommandDefinition = {
  usage: "lore",
  name: "lore",
  summary: "Engineering knowledge tooling for AI coding agents.",
  positionals: [],
  options: globalOptions,
  resultSchema: {
    type: "object",
    required: ["name", "summary", "commands"],
  },
  errorCodes: ["usage.invalid", "runtime.unexpected"],
  exitCodes: [0, 2],
  handler: (output) => {
    renderSuccess(output, "describe", describeCommand());
  },
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
  help: boolean;
  valid: boolean;
  version: boolean;
}

export function inspectInvocation(arguments_: readonly string[]): Invocation {
  const positionals: string[] = [];
  const suppliedOptions: OptionSpec[] = [];
  let help = false;
  let version = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === undefined) {
      continue;
    }

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
        return invalidInvocation("unknown", help, version);
      }
      if (parsedOption.consumeNext) {
        index += 1;
      }
      suppliedOptions.push(parsedOption.option);
      continue;
    }

    if (argument.startsWith("-")) {
      return invalidInvocation(commandFromPositionals(positionals), help, version);
    }

    positionals.push(argument);
  }

  if (help && version) {
    return invalidInvocation(commandFromPositionals(positionals), help, version);
  }

  const command = commandFromPositionals(positionals);
  if (command === "unknown") return invalidInvocation(command, help, version);

  const definition = command === "lore" ? rootCommand : findCommand(command);
  if (
    definition === undefined ||
    !hasValidPositionals(materializeCommandDefinition(definition), positionals.slice(1))
  ) {
    return invalidInvocation(command, help, version);
  }

  if (version && command !== "lore") return invalidInvocation(command, help, version);
  if (!hasAllowedOptions(definition, suppliedOptions))
    return invalidInvocation(command, help, version);
  if (!help && !hasRequiredOptions(definition, suppliedOptions))
    return invalidInvocation(command, help, version);

  return { command, help, valid: true, version };
}

function invalidInvocation(
  command: KnownCommand | "unknown",
  help: boolean,
  version: boolean,
): Invocation {
  return {
    command,
    help,
    valid: false,
    version,
  };
}

interface OptionSpec {
  flag: string;
  takesValue: boolean;
  values?: readonly string[];
}

function commandFromPositionals(positionals: readonly string[]): KnownCommand | "unknown" {
  if (positionals.length === 0) return "lore";
  return findCommand(positionals[0]!)?.name ?? "unknown";
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
): { consumeNext: boolean; option: OptionSpec } | undefined {
  const equalIndex = argument.indexOf("=");
  const flag = equalIndex === -1 ? argument : argument.slice(0, equalIndex);
  const option = allOptionSpecs().find((candidate) => candidate.flag === flag);
  if (option === undefined) return undefined;

  const value = equalIndex === -1 ? nextArgument : argument.slice(equalIndex + 1);
  if (!option.takesValue) return equalIndex === -1 ? { consumeNext: false, option } : undefined;
  if (value === undefined || value.startsWith("-") || !hasAllowedValue(option, value))
    return undefined;

  return { consumeNext: equalIndex === -1, option };
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

function hasAllowedOptions(definition: CommandDefinition, options: readonly OptionSpec[]): boolean {
  const allowed = new Set(
    [...rootCommand.options, ...definition.options].map(toOptionSpec).map((x) => x.flag),
  );
  return options.every((option) => allowed.has(option.flag));
}

function hasRequiredOptions(
  definition: CommandDefinition,
  options: readonly OptionSpec[],
): boolean {
  const suppliedFlags = new Set(options.map((option) => option.flag));
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
