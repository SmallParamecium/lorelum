import type { CommandDefinition, CommandOption, OutputFormat } from "../registry.js";
import { rootCommand } from "../registry.js";
import {
  conflictingOutputFormatsError,
  invalidOutputFormatError,
  unsupportedOutputFormatError,
  type CliError,
} from "../runtime/errors.js";

export interface OutputFormatSelection {
  readonly commandName: string | "unknown";
  readonly format: OutputFormat;
  readonly definition?: CommandDefinition;
  readonly response?: NonNullable<CommandOption["response"]>;
  readonly error?: CliError;
}

/** Resolves format intent before Commander validates command arguments. */
export function resolveOutputFormat(
  arguments_: readonly string[],
  definitions: readonly CommandDefinition[],
): OutputFormatSelection {
  const childDefinition = findCommandDefinition(arguments_, definitions);
  const helpCommand = isHelpCommandInvocation(arguments_);
  const definition = childDefinition ?? (hasCommandWord(arguments_) ? undefined : rootCommand);
  const response = definition === rootCommand ? findRootResponse(arguments_) : undefined;
  const commandName = response?.command ?? definition?.name ?? "unknown";
  const parsed = parseFormatSelectors(arguments_, definition);
  if (parsed.error !== undefined) {
    return {
      commandName,
      format: "json",
      ...(definition === undefined ? {} : { definition }),
      ...(response === undefined ? {} : { response }),
      error: parsed.error,
    };
  }

  const explicitFormats = new Set(parsed.explicitFormats);
  if (parsed.helpRequested || helpCommand) {
    if (explicitFormats.size > 1) {
      return {
        commandName: helpCommand ? "help" : commandName,
        format: "json",
        ...(definition === undefined ? {} : { definition }),
        ...(response === undefined ? {} : { response }),
        error: conflictingOutputFormatsError(),
      };
    }
    return {
      commandName: helpCommand ? "help" : commandName,
      format: "json",
      ...(definition === undefined ? {} : { definition }),
      ...(response === undefined ? {} : { response }),
    };
  }

  if (explicitFormats.size > 1) {
    return {
      commandName,
      format: "json",
      ...(definition === undefined ? {} : { definition }),
      ...(response === undefined ? {} : { response }),
      error: conflictingOutputFormatsError(),
    };
  }

  const formats = response?.output.formats ?? definition?.output.formats ?? ["json"];
  const defaultFormat = response?.output.default ?? definition?.output.default ?? "json";
  const format = parsed.explicitFormats[0] ?? (parsed.agent ? "json" : defaultFormat);
  if (definition !== undefined && !formats.includes(format)) {
    return {
      commandName,
      format: "json",
      definition,
      ...(response === undefined ? {} : { response }),
      error: unsupportedOutputFormatError(),
    };
  }

  return {
    commandName,
    format,
    ...(definition === undefined ? {} : { definition }),
    ...(response === undefined ? {} : { response }),
  };
}

function findRootResponse(arguments_: readonly string[]): CommandOption["response"] | undefined {
  const option = rootCommand.options.find((candidate) => candidate.behavior === "version");
  if (option?.response === undefined) return undefined;
  const flags = new Set([
    option.longFlag,
    ...(option.shortFlag === undefined ? [] : [option.shortFlag]),
  ]);
  const valueFlags = new Set(
    rootCommand.options
      .filter((candidate) => candidate.value !== undefined)
      .flatMap((candidate) => [
        candidate.longFlag,
        ...(candidate.shortFlag === undefined ? [] : [candidate.shortFlag]),
      ]),
  );
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (flags.has(argument)) return option.response;
    if (argument.startsWith("-")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      if (valueFlags.has(flag) && separator === -1) index += 1;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function parseFormatSelectors(
  arguments_: readonly string[],
  definition: CommandDefinition | undefined,
): {
  explicitFormats: OutputFormat[];
  agent: boolean;
  helpRequested: boolean;
  error?: CliError;
} {
  const explicitFormats: OutputFormat[] = [];
  const valueFlags = new Set(
    [...rootCommand.options, ...(definition?.options ?? [])].flatMap((option) =>
      option.value === undefined
        ? []
        : [option.longFlag, ...(option.shortFlag === undefined ? [] : [option.shortFlag])],
    ),
  );
  let agent = false;
  let helpRequested = false;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (argument === "--help" || argument === "-h") {
      helpRequested = true;
      continue;
    }
    if (argument === "--agent") {
      agent = true;
      continue;
    }
    if (argument === "--json") {
      explicitFormats.push("json");
      continue;
    }
    if (argument === "--human") {
      explicitFormats.push("text");
      continue;
    }

    if (argument === "--format") {
      const candidate = arguments_[index + 1];
      if (candidate === undefined || candidate.startsWith("-")) {
        return { explicitFormats, agent, helpRequested, error: invalidOutputFormatError() };
      }
      index += 1;
      if (!isOutputFormat(candidate)) {
        return { explicitFormats, agent, helpRequested, error: invalidOutputFormatError() };
      }
      explicitFormats.push(candidate);
      continue;
    }

    if (argument.startsWith("--format=")) {
      const candidate = argument.slice("--format=".length);
      if (!isOutputFormat(candidate)) {
        return { explicitFormats, agent, helpRequested, error: invalidOutputFormatError() };
      }
      explicitFormats.push(candidate);
      continue;
    }

    if (argument.startsWith("-")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      if (valueFlags.has(flag) && separator === -1) index += 1;
    }
  }

  return { explicitFormats, agent, helpRequested };
}

function isHelpCommandInvocation(arguments_: readonly string[]): boolean {
  const valueFlags = new Set(
    rootCommand.options
      .filter((option) => option.value !== undefined)
      .flatMap((option) => [
        option.longFlag,
        ...(option.shortFlag === undefined ? [] : [option.shortFlag]),
      ]),
  );
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") return false;
    if (argument.startsWith("-")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      if (valueFlags.has(flag) && separator === -1) index += 1;
      continue;
    }
    return argument === "help";
  }
  return false;
}

function isOutputFormat(value: string): value is OutputFormat {
  return value === "json" || value === "text";
}

function findCommandDefinition(
  arguments_: readonly string[],
  definitions: readonly CommandDefinition[],
): CommandDefinition | undefined {
  const words: string[] = [];
  const globalOptions = new Map(
    rootCommand.options.flatMap((option) =>
      [option.longFlag, ...(option.shortFlag === undefined ? [] : [option.shortFlag])].map(
        (flag) => [flag, option.value !== undefined] as const,
      ),
    ),
  );

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (argument.startsWith("-")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      const takesValue = globalOptions.get(flag) ?? flag === "--format";
      if (takesValue && separator === -1) index += 1;
      continue;
    }

    words.push(argument);
    const prefix = words.join(".");
    const definition = definitions.find((candidate) => candidate.name === prefix);
    if (definition !== undefined) return definition;
    if (!definitions.some((candidate) => candidate.name.startsWith(`${prefix}.`))) return undefined;
  }

  return undefined;
}

function hasCommandWord(arguments_: readonly string[]): boolean {
  const valueFlags = new Set(
    rootCommand.options
      .filter((option) => option.value !== undefined)
      .flatMap((option) => [
        option.longFlag,
        ...(option.shortFlag === undefined ? [] : [option.shortFlag]),
      ]),
  );
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (argument.startsWith("-")) {
      const separator = argument.indexOf("=");
      const flag = separator === -1 ? argument : argument.slice(0, separator);
      if (valueFlags.has(flag) && separator === -1) index += 1;
      continue;
    }
    return true;
  }
  return false;
}
