import type { CommandDefinition, CommandOption, OutputFormat } from "../registry.js";
import { rootCommand } from "../registry.js";

export interface OutputFormatSelection {
  readonly commandName: string | "unknown";
  readonly format: OutputFormat;
  readonly definition?: CommandDefinition;
  readonly response?: NonNullable<CommandOption["response"]>;
}

interface ParsedOption {
  readonly flag: string;
  readonly hasInlineValue: boolean;
}

function commandOptionFlags(option: CommandOption): readonly string[] {
  return [option.longFlag, ...(option.shortFlag === undefined ? [] : [option.shortFlag])];
}

function optionFlags(options: readonly CommandOption[]): ReadonlyMap<string, boolean> {
  const flags = new Map<string, boolean>();
  for (const option of options) {
    for (const flag of commandOptionFlags(option)) {
      flags.set(flag, option.value !== undefined);
    }
  }
  return flags;
}

function parseOption(argument: string): ParsedOption | undefined {
  if (!argument.startsWith("-")) return undefined;
  const separator = argument.indexOf("=");
  if (separator === -1) return { flag: argument, hasInlineValue: false };
  return {
    flag: argument.slice(0, separator),
    hasInlineValue: true,
  };
}

function skipOptionValue(
  index: number,
  option: ParsedOption,
  flags: ReadonlyMap<string, boolean>,
): number {
  return !option.hasInlineValue && flags.get(option.flag) === true ? index + 1 : index;
}

/** Resolves the single explicit JSON override before Commander validates arguments. */
export function resolveOutputFormat(
  arguments_: readonly string[],
  definitions: readonly CommandDefinition[],
): OutputFormatSelection {
  const childDefinition = findCommandDefinition(arguments_, definitions);
  const definition = childDefinition ?? (hasCommandWord(arguments_) ? undefined : rootCommand);
  const response = definition === rootCommand ? findRootResponse(arguments_) : undefined;
  const commandName = response?.command ?? definition?.name ?? "unknown";

  return {
    commandName,
    format: hasJsonFlag(arguments_, definition)
      ? "json"
      : (response?.output.default ?? definition?.output.default ?? "json"),
    ...(definition === undefined ? {} : { definition }),
    ...(response === undefined ? {} : { response }),
  };
}

function findRootResponse(arguments_: readonly string[]): CommandOption["response"] | undefined {
  const option = rootCommand.options.find((candidate) => candidate.behavior === "version");
  if (option?.response === undefined) return undefined;
  const flags = new Set(commandOptionFlags(option));
  const valueFlags = optionFlags(rootCommand.options);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (flags.has(argument)) return option.response;
    const parsed = parseOption(argument);
    if (parsed !== undefined) {
      index = skipOptionValue(index, parsed, valueFlags);
      continue;
    }
    return undefined;
  }
  return undefined;
}

function hasJsonFlag(
  arguments_: readonly string[],
  definition: CommandDefinition | undefined,
): boolean {
  const valueFlags = optionFlags([...rootCommand.options, ...(definition?.options ?? [])]);

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    if (argument === "--json") return true;

    const parsed = parseOption(argument);
    if (parsed !== undefined) index = skipOptionValue(index, parsed, valueFlags);
  }

  return false;
}

function findCommandDefinition(
  arguments_: readonly string[],
  definitions: readonly CommandDefinition[],
): CommandDefinition | undefined {
  const words: string[] = [];
  let matched: CommandDefinition | undefined;
  const globalOptions = optionFlags(rootCommand.options);

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    const parsed = parseOption(argument);
    if (parsed !== undefined) {
      index = skipOptionValue(index, parsed, globalOptions);
      continue;
    }

    words.push(argument);
    const prefix = words.join(".");
    const definition = definitions.find((candidate) => candidate.name === prefix);
    const hasChildren = definitions.some((candidate) => candidate.name.startsWith(`${prefix}.`));
    if (definition !== undefined) {
      matched = definition;
      if (!hasChildren) return definition;
      continue;
    }
    if (!hasChildren) return matched;
  }

  return matched;
}

function hasCommandWord(arguments_: readonly string[]): boolean {
  const valueFlags = optionFlags(rootCommand.options);
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") break;
    const parsed = parseOption(argument);
    if (parsed !== undefined) {
      index = skipOptionValue(index, parsed, valueFlags);
      continue;
    }
    return true;
  }
  return false;
}
