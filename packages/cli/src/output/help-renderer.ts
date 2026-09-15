export function renderHelpText(value: unknown): string {
  const description = record(value, "command description");
  const name = string(description.name, "name");
  const usage = string(description.usage, "usage");
  const summary = string(description.summary, "summary");
  const isRoot = name === "lore";
  const isGroup = Array.isArray(description.commands);
  const displayUsage = isRoot
    ? "lore [options] <command>"
    : isGroup
      ? `lore ${usage} <command>`
      : `lore ${usage}`;
  const lines = [`Usage: ${displayUsage}`, "", summary];

  if (isRoot || isGroup) {
    const commands = array(description.commands, "commands");
    if (commands.length > 0) {
      lines.push("", isRoot ? "Commands:" : "Subcommands:");
      const entries = commands.map((item, index) => {
        const command = record(item, `commands[${index}]`);
        return [
          string(command.usage, `commands[${index}].usage`),
          string(command.summary, `commands[${index}].summary`),
        ] as const;
      });
      if (isRoot)
        entries.push(["help [command...]", "Show human-readable help for Lorelum commands."]);
      const width = Math.max(...entries.map(([label]) => label.length));
      for (const [label, detail] of entries) lines.push(`  ${label.padEnd(width)}  ${detail}`);
    }
  } else {
    const positionals = array(description.positionals, "positionals");
    if (positionals.length > 0) {
      lines.push("", "Arguments:");
      for (const [index, item] of positionals.entries()) {
        const positional = record(item, `positionals[${index}]`);
        const positionalName = string(positional.name, `positionals[${index}].name`);
        const required = positional.required === true;
        const values = Array.isArray(positional.values)
          ? ` (choices: ${stringArray(positional.values, `positionals[${index}].values`).join(", ")})`
          : "";
        lines.push(
          `  ${required ? `<${positionalName}>` : `[${positionalName}]`}${required ? " (required)" : ""}${values}`,
        );
      }
    }
  }

  const options = array(description.options, "options");
  if (options.length > 0) {
    lines.push("", "Options:");
    const entries = options.map((item, index) => {
      const option = record(item, `options[${index}]`);
      const optionName = string(option.name, `options[${index}].name`);
      const detail = string(option.description, `options[${index}].description`);
      const values = Array.isArray(option.values)
        ? ` (choices: ${stringArray(option.values, `options[${index}].values`).join(", ")})`
        : "";
      const defaultValue =
        typeof option.defaultValue === "string" ? ` (default: ${option.defaultValue})` : "";
      return [optionName, `${detail}${values}${defaultValue}`] as const;
    });
    const width = Math.max(...entries.map(([label]) => label.length));
    for (const [label, detail] of entries) lines.push(`  ${label.padEnd(width)}  ${detail}`);
  }

  return lines.join("\n");
}

function record(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Help renderer expected an object at ${field}.`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Help renderer expected an array at ${field}.`);
  return value;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new TypeError(`Help renderer expected a string at ${field}.`);
  return value;
}

function stringArray(value: readonly unknown[], field: string): readonly string[] {
  return value.map((item, index) => string(item, `${field}[${index}]`));
}
