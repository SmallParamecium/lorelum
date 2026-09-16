import {
  InvalidSourcePathError,
  PackNotInstalledError,
  PackValidationError,
  PracticeConflictError,
  SnapshotFormatError,
  StoreBusyError,
  StoreRecoveryRequiredError,
  UpgradeRequiredError,
  decodePackDirectory,
  type DecodedPackDirectory,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";
import type { RegistryRelease } from "@lorelum/format";
import type { IndexRuntimeClient } from "@lorelum/backend/coordination";

import type { JsonSchema, JsonValue } from "../output/protocol.js";
import type { OutputWriter } from "../output/protocol.js";
import { jsonOnlyOutput, textDefaultOutput } from "../output/formats.js";
import { renderPackInstallText } from "../output/text-renderers.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, cliErrorCodes, frameworkErrorCodes } from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import {
  mutationResultProperties,
  mutationResultRequired,
  stringSchema,
  toMutationResultData,
} from "../store/mutation-result.js";
import { loadRegistry, type LoadedRegistry } from "./load-registry.js";
import { materializeRegistryRelease, type MaterializedPackSource } from "./materialize-source.js";
import { parsePackSpecifier } from "./pack-specifier.js";
import { resolveRegistryRelease } from "./resolve-release.js";
import {
  failedInstallIndexSync,
  type InstallIndexSync,
  syncSemanticIndexAfterInstall,
} from "./sync-semantic-index.js";

export interface InstallCommandServices {
  /** Core storage dependencies are supplied by the CLI composition root. */
  readonly store: Pick<LocalStore, "install" | "upgrade">;
  readonly storageRoot: StorageRoot;
  /** Install submits derived-index synchronization after its canonical commit. */
  readonly createIndexRuntimeClient: () => Promise<IndexRuntimeClient>;
  readonly progressWriter?: OutputWriter;
  /** Ancillary dependencies default to the production implementations. */
  readonly loadRegistry?: (locator?: string) => Promise<LoadedRegistry>;
  readonly materializeRelease?: (
    release: RegistryRelease,
    repository: string,
  ) => Promise<MaterializedPackSource>;
  readonly decodePackDirectory?: (directory: string) => Promise<DecodedPackDirectory>;
}

type ResolvedInstallCommandServices = Required<InstallCommandServices>;

const indexSyncSchema: JsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "operationId", "phase"],
      properties: {
        state: { const: "pending" },
        operationId: stringSchema,
        phase: { enum: ["preparing", "building"] },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "index"],
      properties: {
        state: { const: "ready" },
        index: {
          type: "object",
          additionalProperties: false,
          required: ["state", "profileId"],
          properties: {
            state: { enum: ["ready"] },
            profileId: stringSchema,
            vectorCount: { type: "integer" },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["state", "error"],
      properties: {
        state: { const: "failed" },
        error: {
          type: "object",
          additionalProperties: false,
          required: ["code", "message"],
          properties: { code: stringSchema, message: stringSchema },
        },
      },
    },
  ],
};

const registryMutationResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "pack",
    "registry",
    "source",
    ...mutationResultRequired,
    "idempotent",
    "artifactDigest",
    "packRoot",
  ],
  properties: {
    pack: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version"],
      properties: { name: stringSchema, version: stringSchema },
    },
    registry: {
      type: "object",
      additionalProperties: false,
      required: ["name", "repository"],
      properties: { name: stringSchema, repository: stringSchema },
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ref", "commit"],
      properties: { type: { const: "git" }, ref: stringSchema, commit: stringSchema },
    },
    ...mutationResultProperties,
    idempotent: { type: "boolean" },
    artifactDigest: stringSchema,
    packRoot: stringSchema,
  },
};

const installResultSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "pack",
    "registry",
    "source",
    ...mutationResultRequired,
    "idempotent",
    "artifactDigest",
    "packRoot",
    "indexSync",
  ],
  properties: {
    pack: {
      type: "object",
      additionalProperties: false,
      required: ["name", "version"],
      properties: { name: stringSchema, version: stringSchema },
    },
    registry: {
      type: "object",
      additionalProperties: false,
      required: ["name", "repository"],
      properties: { name: stringSchema, repository: stringSchema },
    },
    source: {
      type: "object",
      additionalProperties: false,
      required: ["type", "ref", "commit"],
      properties: { type: { const: "git" }, ref: stringSchema, commit: stringSchema },
    },
    ...mutationResultProperties,
    idempotent: { type: "boolean" },
    artifactDigest: stringSchema,
    packRoot: stringSchema,
    indexSync: indexSyncSchema,
  },
};

const registryMutationErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.registryUnavailable,
  cliErrorCodes.registryInvalid,
  cliErrorCodes.registryPackNotFound,
  cliErrorCodes.registryVersionNotFound,
  cliErrorCodes.sourceUnavailable,
  cliErrorCodes.sourceInvalid,
  cliErrorCodes.packInvalid,
  cliErrorCodes.practiceConflict,
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
]);

const installErrorCodes = Object.freeze([
  ...registryMutationErrorCodes,
  cliErrorCodes.packUpdateRequired,
]);

const updateErrorCodes = Object.freeze([
  ...registryMutationErrorCodes,
  cliErrorCodes.packNotInstalled,
]);

function optionString(
  options: Readonly<Record<string, unknown>>,
  name: string,
): string | undefined {
  const value = options[name];
  return typeof value === "string" ? value : undefined;
}

function throwVisibleRegistryMutationError(error: unknown): never {
  if (error instanceof CliError) throw error;
  if (
    error instanceof SnapshotFormatError ||
    error instanceof PackValidationError ||
    error instanceof InvalidSourcePathError
  ) {
    throw new CliError(cliErrorCodes.packInvalid, "The selected Pack is invalid.");
  }
  if (error instanceof UpgradeRequiredError) {
    throw new CliError(
      cliErrorCodes.packUpdateRequired,
      "The selected Pack has changed; use `lore pack update` to replace it.",
    );
  }
  if (error instanceof PackNotInstalledError) {
    throw new CliError(cliErrorCodes.packNotInstalled, "The specified Pack is not installed.");
  }
  if (error instanceof PracticeConflictError) {
    throw new CliError(
      cliErrorCodes.practiceConflict,
      `Practice "${error.practiceId}" conflicts with an installed Pack.`,
    );
  }
  if (error instanceof StoreBusyError) {
    throw new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
  }
  if (error instanceof StoreRecoveryRequiredError) {
    throw new CliError(
      cliErrorCodes.storeRecoveryRequired,
      "The local Pack store requires recovery.",
    );
  }
  throw error;
}

type RegistryMutationOperation = "install" | "update";

async function mutateRegistryPack(
  services: ResolvedInstallCommandServices,
  storageRoot: StorageRoot,
  packName: string,
  requestedVersion?: string,
  registryLocator?: string,
  operation: RegistryMutationOperation = "install",
): Promise<JsonValue> {
  const loaded = await services.loadRegistry(registryLocator);
  const resolved = resolveRegistryRelease(loaded.registry, packName, requestedVersion);
  const materialized = await services.materializeRelease(
    resolved.release,
    loaded.repository.gitUrl,
  );
  try {
    const decoded = await services.decodePackDirectory(materialized.directory);
    if (
      decoded.candidate.pack.name !== resolved.pack.name ||
      decoded.candidate.pack.version !== resolved.release.version
    ) {
      throw new CliError(
        cliErrorCodes.packInvalid,
        "The fetched Pack identity does not match the Registry release.",
      );
    }
    const result = await services.store[operation === "update" ? "upgrade" : "install"](
      storageRoot,
      decoded.candidate,
      decoded.diagnostics,
    );
    const data = {
      pack: { name: decoded.candidate.pack.name, version: decoded.candidate.pack.version },
      registry: { name: loaded.registry.name, repository: loaded.repository.slug },
      source: {
        type: "git",
        ref: materialized.resolvedRef,
        commit: materialized.resolvedCommit,
      },
      ...toMutationResultData(result),
      idempotent: result.idempotent,
      cleanupPending: result.cleanupPending,
      artifactDigest: result.artifactDigest,
      packRoot: result.packRoot,
    };
    if (operation !== "install") return data;
    const indexSync = await synchronizeIndex(services, storageRoot);
    if (indexSync.state === "failed") {
      try {
        services.progressWriter.write("index: sync failed; run lore index build for this Store\n");
      } catch {
        /* Closed stderr must not change the canonical install result. */
      }
    }
    return { ...data, indexSync };
  } finally {
    await materialized.cleanup().catch(() => undefined);
  }
}

async function synchronizeIndex(
  services: ResolvedInstallCommandServices,
  root: StorageRoot,
): Promise<InstallIndexSync> {
  try {
    return await syncSemanticIndexAfterInstall(root, await services.createIndexRuntimeClient());
  } catch (error) {
    return failedInstallIndexSync(error);
  }
}

function createRegistryMutationCommand(
  operation: RegistryMutationOperation,
  services: InstallCommandServices,
): CommandDefinition {
  const resolvedServices = {
    loadRegistry: services.loadRegistry ?? loadRegistry,
    materializeRelease: services.materializeRelease ?? materializeRegistryRelease,
    decodePackDirectory: services.decodePackDirectory ?? decodePackDirectory,
    createIndexRuntimeClient: services.createIndexRuntimeClient,
    progressWriter: services.progressWriter ?? process.stderr,
    store: services.store,
    storageRoot: services.storageRoot,
  };
  return {
    name: `pack.${operation}`,
    summary:
      operation === "install"
        ? "Install a Knowledge Pack into the selected local Store."
        : "Update an installed Knowledge Pack in the selected local Store.",
    positionals: [{ name: "pack[@version]", required: true }],
    options: [
      {
        longFlag: "--registry",
        description: "Use a GitHub repository containing .lorelum/registry.yaml.",
        value: { name: "repository", required: true },
        optionRequired: false,
      },
    ],
    output: operation === "install" ? textDefaultOutput : jsonOnlyOutput,
    ...(operation === "install" ? { textRenderer: renderPackInstallText } : {}),
    resultSchema: operation === "install" ? installResultSchema : registryMutationResultSchema,
    errorCodes: operation === "install" ? installErrorCodes : updateErrorCodes,
    exitCodes: [0, 2],
    async handler(invocation) {
      try {
        // Validate the compact Pack reference before touching the Registry or Store.
        const specifier = parsePackSpecifier(invocation.positionals[0]!);
        return {
          data: await mutateRegistryPack(
            resolvedServices,
            resolveInvocationStorageRoot(
              invocation.options.storeRoot,
              resolvedServices.storageRoot,
            ),
            specifier.packName,
            specifier.requestedVersion,
            optionString(invocation.options, "registry"),
            operation,
          ),
        };
      } catch (error) {
        throwVisibleRegistryMutationError(error);
      }
    },
  };
}

export function createInstallCommand(services: InstallCommandServices): CommandDefinition {
  return createRegistryMutationCommand("install", services);
}

export function createUpdateCommand(services: InstallCommandServices): CommandDefinition {
  return createRegistryMutationCommand("update", services);
}
