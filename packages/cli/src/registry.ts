import { logLevels, type LogLevel } from "./runtime/logger.js";
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

export type CommandHandler = (output: OutputWriter, target?: string) => void;

const globalOptions = [
  {
    name: "--log-level <level>",
    description: "Set stderr log verbosity.",
    required: false,
    values: logLevels,
  },
] as const satisfies readonly CommandOption[];

export const commandRegistry = [
  {
    usage: "describe [command]",
    name: "describe",
    summary: "Return machine-readable command capabilities.",
    positionals: [
      {
        name: "command",
        required: false,
        values: ["describe"],
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
    handler: (output, target) => {
      const description = describeCommand(target === undefined ? undefined : "describe");
      if (description === undefined) throw new Error("Unreachable command registry state.");
      renderSuccess(output, "describe", description);
    },
  },
] as const satisfies readonly CommandDefinition[];

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

export type KnownCommand = "lore" | "describe";

export function describeCommand(command?: KnownCommand): object | undefined {
  if (command === "describe") {
    return commandRegistry[0];
  }

  if (command === "lore" || command === undefined) {
    return {
      ...rootCommand,
      commands: commandRegistry,
    };
  }

  return undefined;
}

export interface Invocation {
  command: KnownCommand | "unknown";
  help: boolean;
  valid: boolean;
  version: boolean;
}

export function inspectInvocation(arguments_: readonly string[]): Invocation {
  const positionals: string[] = [];
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

    if (argument === "--log-level") {
      const level = arguments_[index + 1];
      if (level === undefined || !isLogLevel(level)) {
        return invalidInvocation(positionals, help, version);
      }
      index += 1;
      continue;
    }

    if (argument.startsWith("--log-level=")) {
      const level = argument.slice("--log-level=".length);
      if (!isLogLevel(level)) return invalidInvocation(positionals, help, version);
      continue;
    }

    if (argument.startsWith("-")) {
      return invalidInvocation(positionals, help, version);
    }

    positionals.push(argument);
  }

  if (help && version) {
    return invalidInvocation(positionals, help, version);
  }

  if (positionals.length === 0) {
    return { command: "lore", help, valid: true, version };
  }

  if (positionals[0] !== "describe") {
    return { command: "unknown", help, valid: false, version };
  }

  if (positionals.length > 2 || (positionals[1] !== undefined && positionals[1] !== "describe")) {
    return { command: "describe", help, valid: false, version };
  }

  if (version) {
    return { command: "describe", help, valid: false, version };
  }

  return { command: "describe", help, valid: true, version };
}

function invalidInvocation(
  positionals: readonly string[],
  help: boolean,
  version: boolean,
): Invocation {
  return {
    command: positionals[0] === "describe" ? "describe" : "unknown",
    help,
    valid: false,
    version,
  };
}

function isLogLevel(value: string): value is LogLevel {
  return logLevels.includes(value as LogLevel);
}
