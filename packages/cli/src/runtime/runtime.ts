import {
  loadConfig,
  resolveConfigPath,
  type ConfigEnvironment,
  type LoadedConfig,
} from "./config.js";
import { Logger } from "./logger.js";
import type { OutputWriter } from "../output/protocol.js";

export interface CliRuntime {
  readonly configPath: string;
  readonly configSource: "default" | "environment" | "explicit";
  readonly logger: Logger;
  loadConfig(): Promise<LoadedConfig>;
}

export interface RuntimeOptions extends ConfigEnvironment {
  errorWriter?: OutputWriter;
}

export function createRuntime(options: RuntimeOptions = {}): CliRuntime {
  const resolved = resolveConfigPath(options);
  const explicit = resolved.source !== "default";

  return {
    configPath: resolved.path,
    configSource: resolved.source,
    logger: new Logger(options.errorWriter ?? process.stderr),
    loadConfig: () => loadConfig(resolved.path, explicit, options.fileSystem),
  };
}
