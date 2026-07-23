import {
  parseFrontmatter,
  parseYamlDocument,
  type DecisionNode,
  type Pack,
  type PackInput,
  type Practice,
} from "@lorelum/format";
import { basename, join, relative, sep } from "node:path";

import {
  PackLoadError,
  type PackFileMetadata,
  type PackFileSystem,
  type PackLoader,
} from "./types.js";

const maxInputFiles = 128;
const maxTotalBytes = 4 * 1024 * 1024;
const maxPackBytes = 64 * 1024;
const maxDecisionBytes = 256 * 1024;
const maxPracticeBytes = 512 * 1024;

/**
 * Loads the v1 directory layout described by ADR 0006. The loader only reads
 * explicitly named input files and delegates all semantic validation to format.
 */
export function createPackLoader(fileSystem: PackFileSystem): PackLoader {
  return { load: (packPath) => loadPack(fileSystem, packPath) };
}

async function loadPack(fileSystem: PackFileSystem, packPath: string): Promise<PackInput> {
  const root = packPath;
  await assertDirectory(fileSystem, root, "pack.path_invalid");

  const pack = await readYamlFile(fileSystem, root, "pack.yaml", maxPackBytes);
  const decisionsPath = join(root, "decisions.yaml");
  const optionalDecisions = await readOptionalYamlFile(fileSystem, decisionsPath, maxDecisionBytes);
  const practices = await loadPractices(fileSystem, root, optionalDecisions !== undefined);

  return {
    pack: pack as Pack,
    practices: practices as Practice[],
    decisions: (optionalDecisions ?? []) as DecisionNode[],
  };
}

async function loadPractices(
  fileSystem: PackFileSystem,
  root: string,
  hasDecisions: boolean,
): Promise<unknown[]> {
  const directory = join(root, "practices");
  const metadata = await lstat(fileSystem, directory);
  if (metadata.kind === "missing") return [];
  if (metadata.kind !== "directory") throw unreadable();

  const entries = await readDirectory(fileSystem, directory);
  const candidates = entries.filter((entry) => entry.name.endsWith(".md"));
  if (candidates.some((entry) => entry.kind !== "file")) throw unreadable();
  const markdown = candidates;
  if (markdown.length + 1 + Number(hasDecisions) > maxInputFiles) throw unreadable();

  let totalBytes = 0;
  const contents: string[] = [];
  for (const entry of markdown.sort((left, right) => left.name.localeCompare(right.name))) {
    // Read sequentially so the aggregate limit is enforced before the next input opens.
    // eslint-disable-next-line no-await-in-loop
    const content = await readFile(fileSystem, childPath(root, directory, entry.name), maxPracticeBytes);
    totalBytes += Buffer.byteLength(content);
    if (totalBytes > maxTotalBytes) throw unreadable();
    contents.push(content);
  }
  return contents.map(parsePractice);
}

async function readYamlFile(
  fileSystem: PackFileSystem,
  root: string,
  name: "pack.yaml",
  maxBytes: number,
): Promise<unknown> {
  const path = join(root, name);
  const content = await readFile(fileSystem, path, maxBytes);
  return parseYaml(content);
}

async function readOptionalYamlFile(
  fileSystem: PackFileSystem,
  path: string,
  maxBytes: number,
): Promise<unknown | undefined> {
  if ((await lstat(fileSystem, path)).kind === "missing") return undefined;
  return parseYaml(await readFile(fileSystem, path, maxBytes));
}

async function assertDirectory(
  fileSystem: PackFileSystem,
  path: string,
  code: "pack.path_invalid",
) {
  const metadata = await lstat(fileSystem, path);
  if (metadata.kind !== "directory") {
    throw new PackLoadError(code, "The pack path must be a readable directory.");
  }
}

async function readFile(
  fileSystem: PackFileSystem,
  path: string,
  maxBytes: number,
): Promise<string> {
  try {
    return await fileSystem.readRegularFile(path, maxBytes);
  } catch {
    throw unreadable();
  }
}

async function lstat(fileSystem: PackFileSystem, path: string): Promise<PackFileMetadata> {
  try {
    return await fileSystem.lstat(path);
  } catch {
    throw unreadable();
  }
}

async function readDirectory(fileSystem: PackFileSystem, path: string) {
  try {
    return await fileSystem.readDirectory(path);
  } catch {
    throw unreadable();
  }
}

function childPath(root: string, directory: string, name: string): string {
  if (basename(name) !== name) throw unreadable();
  const path = join(directory, name);
  const pathToRoot = relative(root, path);
  if (pathToRoot === "" || pathToRoot.startsWith(`..${sep}`) || pathToRoot === "..")
    throw unreadable();
  return path;
}

function parseYaml(content: string): unknown {
  try {
    return parseYamlDocument(content);
  } catch {
    throw new PackLoadError("pack.parse_error", "A pack document could not be parsed.");
  }
}

function parsePractice(content: string): unknown {
  try {
    const frontmatter = parseFrontmatter(content);
    return { ...frontmatter.data, body: frontmatter.content };
  } catch {
    throw new PackLoadError("pack.parse_error", "A pack document could not be parsed.");
  }
}

function unreadable(): PackLoadError {
  return new PackLoadError("pack.unreadable", "A pack input could not be read.");
}
