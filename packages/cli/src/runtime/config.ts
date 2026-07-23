import type { Stats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { z } from "zod";

import { CliError } from "./errors.js";

const maxConfigBytes = 64 * 1024;
const configSchema = z.object({ version: z.literal(1) }).strict();

export type LorelumConfig = z.infer<typeof configSchema>;

export interface ConfigEnvironment {
  env?: Record<string, string | undefined>;
  explicitPath?: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}

export interface ResolvedConfigPath {
  path: string;
  source: "default" | "environment" | "explicit";
}

export interface LoadedConfig {
  configuration: LorelumConfig;
  source: "default" | "file";
}

export function resolveConfigPath(options: ConfigEnvironment = {}): ResolvedConfigPath {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const path = platform === "win32" ? win32 : posix;
  const explicitPath = options.explicitPath;

  if (explicitPath !== undefined) {
    return { path: resolveAbsolutePath(path, explicitPath, "--config"), source: "explicit" };
  }

  if (environment.LORELUM_CONFIG !== undefined) {
    return {
      path: resolveAbsolutePath(path, environment.LORELUM_CONFIG, "LORELUM_CONFIG"),
      source: "environment",
    };
  }

  const homeDirectory = options.homeDirectory ?? homedir();
  if (platform === "win32") {
    return {
      path: path.join(
        resolveAbsolutePath(
          path,
          environment.APPDATA ?? path.join(homeDirectory, "AppData", "Roaming"),
          "APPDATA",
        ),
        "Lorelum",
        "config.json",
      ),
      source: "default",
    };
  }

  return {
      path: path.join(
      resolveAbsolutePath(
        path,
        environment.XDG_CONFIG_HOME ?? path.join(homeDirectory, ".config"),
        "XDG_CONFIG_HOME",
      ),
      "lorelum",
      "config.json",
    ),
    source: "default",
  };
}

export async function loadConfig(path: string, explicit: boolean): Promise<LoadedConfig> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch (error) {
    if (!explicit && isNotFoundError(error)) {
      return { configuration: { version: 1 }, source: "default" };
    }
    throw new CliError("config.unreadable", "Unable to read the local configuration.");
  }

  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new CliError("config.unreadable", "The local configuration must be a regular file.");
  }

  const handle = await openConfigFile(path);
  try {
    const openedMetadata = await handle.stat();
    if (!openedMetadata.isFile() || !sameFile(metadata, openedMetadata)) {
      throw new CliError("config.unreadable", "Unable to read the local configuration.");
    }
    if (openedMetadata.size > maxConfigBytes) {
      throw new CliError("config.too_large", "The local configuration exceeds 64 KiB.");
    }

    const contents = await handle.readFile({ encoding: "utf8" });
    return parseConfig(contents);
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }
    throw new CliError("config.unreadable", "Unable to read the local configuration.");
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function resolveAbsolutePath(path: typeof posix, value: string, name: string): string {
  if (value.length === 0 || !path.isAbsolute(value)) {
    throw new CliError("config.path_invalid", `${name} must be an absolute path.`);
  }
  return path.normalize(value);
}

async function openConfigFile(path: string) {
  try {
    return await open(path, "r");
  } catch {
    throw new CliError("config.unreadable", "Unable to read the local configuration.");
  }
}

function parseConfig(contents: string): LoadedConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new CliError("config.invalid_json", "The local configuration is not valid JSON.");
  }

  const result = configSchema.safeParse(parsed);
  if (result.success) {
    return { configuration: result.data, source: "file" };
  }

  if (hasUnknownField(parsed)) {
    throw new CliError(
      "config.unknown_field",
      "The local configuration contains an unsupported field.",
    );
  }
  throw new CliError("config.unsupported_version", "The local configuration must have version 1.");
}

function sameFile(before: Stats, after: Stats): boolean {
  return before.dev === after.dev && before.ino === after.ino;
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function hasUnknownField(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => key !== "version")
  );
}
