import type { JsonValue } from "./protocol.js";

export type TextRenderer = (data: JsonValue) => string;

type JsonObject = Readonly<Record<string, unknown>>;

function object(value: unknown, field: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`Text renderer expected an object at ${field}.`);
  }
  return value as JsonObject;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new TypeError(`Text renderer expected a string at ${field}.`);
  return value;
}

function integer(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new TypeError(`Text renderer expected an integer at ${field}.`);
  }
  return value;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new TypeError(`Text renderer expected a boolean at ${field}.`);
  return value;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`Text renderer expected an array at ${field}.`);
  return value;
}

function stringArray(value: unknown, field: string): readonly string[] {
  return array(value, field).map((item, index) => string(item, `${field}[${index}]`));
}

function snapshotLine(data: JsonObject): string {
  return `Store snapshot: generation ${integer(data.generation, "generation")}, effective revision ${integer(data.effectiveRevision, "effectiveRevision")}`;
}

export const renderVersionText: TextRenderer = (data) => {
  const version = object(data, "version");
  return `Lorelum ${string(version.toolVersion, "toolVersion")} (protocol ${integer(version.protocolVersion, "protocolVersion")})`;
};

/** `get` intentionally projects only the complete Practice body. */
export const renderGetText: TextRenderer = (data) => {
  const result = object(data, "get result");
  const practice = object(result.practice, "practice");
  return string(practice.body, "practice.body");
};

export const renderPackListText: TextRenderer = (data) => {
  const result = object(data, "list result");
  const snapshot = snapshotLine(result);

  if ("pack" in result) {
    const pack = object(result.pack, "pack");
    const practices = array(result.practices, "practices");
    const lines = [
      snapshot,
      `Pack: ${string(pack.name, "pack.name")}@${string(pack.version, "pack.version")}`,
    ];
    if (practices.length === 0) {
      lines.push("No Practices.");
      return lines.join("\n");
    }
    lines.push(`Practices (${practices.length}):`);
    for (const [index, value] of practices.entries()) {
      const practice = object(value, `practices[${index}]`);
      lines.push(
        `  ${string(practice.id, `practices[${index}].id`)} — ${string(practice.title, `practices[${index}].title`)}`,
      );
      lines.push(
        `    Applies when: ${string(practice.applies_when, `practices[${index}].applies_when`)}`,
      );
    }
    return lines.join("\n");
  }

  const packs = array(result.packs, "packs");
  if (packs.length === 0) return `${snapshot}\nNo installed Packs.`;

  const firstPack = object(packs[0], "packs[0]");
  if ("practiceCount" in firstPack) {
    const lines = [snapshot, `Installed Packs (${packs.length}):`];
    for (const [index, value] of packs.entries()) {
      const pack = object(value, `packs[${index}]`);
      lines.push(
        `  ${string(pack.name, `packs[${index}].name`)}@${string(pack.version, `packs[${index}].version`)} (${integer(pack.practiceCount, `packs[${index}].practiceCount`)} Practices)`,
      );
    }
    return lines.join("\n");
  }

  const lines = [snapshot, `Installed Packs (${packs.length}):`];
  for (const [index, value] of packs.entries()) {
    const pack = object(value, `packs[${index}]`);
    const name = string(pack.name, `packs[${index}].name`);
    const version = string(pack.version, `packs[${index}].version`);
    lines.push(`  ${name}@${version}`);
    if (typeof pack.description === "string") lines.push(`    ${pack.description}`);
    const appliesTo = stringArray(pack.appliesTo, `packs[${index}].appliesTo`);
    if (appliesTo.length > 0) lines.push(`    Applies to: ${appliesTo.join(", ")}`);
  }
  return lines.join("\n");
};

export const renderPackInstallText: TextRenderer = (data) => {
  const result = object(data, "install result");
  const pack = object(result.pack, "pack");
  const registry = object(result.registry, "registry");
  const source = object(result.source, "source");
  const delta = object(result.delta, "delta");
  const lines = [
    `${boolean(result.idempotent, "idempotent") ? "Already installed" : "Installed"} ${string(pack.name, "pack.name")}@${string(pack.version, "pack.version")}.`,
    `Registry: ${string(registry.name, "registry.name")} (${string(registry.repository, "registry.repository")})`,
    `Source: ${string(source.type, "source.type")} ${string(source.ref, "source.ref")}`,
    snapshotLine(result),
  ];
  const changes = [
    ["Added", stringArray(delta.added, "delta.added")],
    ["Changed", stringArray(delta.changed, "delta.changed")],
    ["Invalidated", stringArray(delta.invalidated, "delta.invalidated")],
  ] as const;
  const changeCount = changes.reduce((count, [, values]) => count + values.length, 0);
  if (changeCount === 0) {
    lines.push("Practice changes: none.");
  } else {
    lines.push("Practice changes:");
    for (const [label, values] of changes) {
      if (values.length > 0) lines.push(`  ${label}: ${values.join(", ")}`);
    }
  }
  if (boolean(result.cleanupPending, "cleanupPending")) lines.push("Cleanup: pending.");

  if (Array.isArray(result.diagnostics) && result.diagnostics.length > 0) {
    lines.push("Diagnostics:");
    for (const [index, value] of result.diagnostics.entries()) {
      const diagnostic = object(value, `diagnostics[${index}]`);
      lines.push(
        `  ${string(diagnostic.level, `diagnostics[${index}].level`)}[${string(diagnostic.code, `diagnostics[${index}].code`)}] ${string(diagnostic.path, `diagnostics[${index}].path`)}: ${string(diagnostic.message, `diagnostics[${index}].message`)}`,
      );
    }
  }

  if (result.indexSync !== undefined) {
    const sync = object(result.indexSync, "indexSync");
    const state = string(sync.state, "indexSync.state");
    if (state === "pending") {
      lines.push(
        `Semantic index: pending (${string(sync.phase, "indexSync.phase")}; operation ${string(sync.operationId, "indexSync.operationId")}).`,
      );
    } else if (state === "ready") {
      const index = object(sync.index, "indexSync.index");
      lines.push(
        `Semantic index: ready${typeof index.vectorCount === "number" ? ` (${integer(index.vectorCount, "indexSync.index.vectorCount")} vectors)` : ""}.`,
      );
    } else if (state === "failed") {
      const error = object(sync.error, "indexSync.error");
      lines.push(
        `Semantic index: failed [${string(error.code, "indexSync.error.code")}]: ${string(error.message, "indexSync.error.message")}`,
      );
    } else {
      throw new TypeError("Text renderer encountered an unknown indexSync state.");
    }
  }
  return lines.join("\n");
};

export const renderQueryText: TextRenderer = (data) => {
  const result = object(data, "query result");
  if (result.state === "preparing") {
    return `Semantic query is preparing.\n${string(result.message, "message")}`;
  }
  if (result.state === "indexing") {
    const indexed = integer(result.indexedPracticeCount, "indexedPracticeCount");
    const total = integer(result.totalPracticeCount, "totalPracticeCount");
    return [
      "Semantic query is indexing.",
      string(result.message, "message"),
      `Indexed Practices: ${indexed}/${total}`,
    ].join("\n");
  }

  const mode = string(result.mode, "mode");
  if (mode !== "semantic" && mode !== "keyword") {
    throw new TypeError("Text renderer encountered an unknown query mode.");
  }
  const results = array(result.results, "results");
  const heading =
    mode === "semantic"
      ? `Query mode: semantic (coverage: ${string(result.coverage, "coverage")})`
      : "Query mode: keyword";
  if (results.length === 0) return `${heading}\nNo matching Practices.`;

  const lines = [heading, `Matched Practices (${results.length}):`];
  for (const [index, value] of results.entries()) {
    const hit = object(value, `results[${index}]`);
    lines.push(
      `${index + 1}. ${string(hit.practiceId, `results[${index}].practiceId`)} — ${string(hit.title, `results[${index}].title`)}`,
    );
    lines.push(`   Stage: ${string(hit.stage, `results[${index}].stage`)}`);
    lines.push(`   Severity: ${string(hit.severity, `results[${index}].severity`)}`);
    const techStack = stringArray(hit.techStack, `results[${index}].techStack`);
    lines.push(`   Tech stack: ${techStack.length === 0 ? "(none)" : techStack.join(", ")}`);
    lines.push(`   Applies when: ${string(hit.appliesWhen, `results[${index}].appliesWhen`)}`);
  }
  return lines.join("\n");
};
