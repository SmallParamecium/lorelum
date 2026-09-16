import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  type LocalStore,
  type StorageRoot,
} from "@lorelum/engine";
import { ID_REGEX } from "@lorelum/format";

import { textDefaultOutput } from "../output/formats.js";
import { renderGetText } from "../output/text-renderers.js";
import type { CommandDefinition } from "../registry.js";
import {
  CliError,
  cliErrorCodes,
  frameworkErrorCodes,
  invalidInvocationError,
} from "../runtime/errors.js";
import { resolveInvocationStorageRoot } from "../store/storage-root.js";
import { getResultSchema } from "./result-schema.js";

export interface GetCommandServices {
  readonly store: Pick<LocalStore, "getEffectivePracticeWithPackRoots">;
  readonly storageRoot: StorageRoot;
}

export function createGetCommand(services: GetCommandServices): CommandDefinition {
  return {
    name: "get",
    summary: "Read one installed Practice by its exact ID from the selected local Store.",
    positionals: [{ name: "practice-id", required: true }],
    options: [],
    output: textDefaultOutput,
    textRenderer: renderGetText,
    textOutputMode: "verbatim",
    resultSchema: getResultSchema,
    errorCodes: [
      ...frameworkErrorCodes,
      cliErrorCodes.practiceNotFound,
      cliErrorCodes.storeBusy,
      cliErrorCodes.storeRecoveryRequired,
    ],
    exitCodes: [0, 2],
    async handler(invocation) {
      const id = invocation.positionals[0];
      if (id === undefined || !ID_REGEX.test(id)) throw invalidInvocationError();
      const root = resolveInvocationStorageRoot(invocation.options.storeRoot, services.storageRoot);
      try {
        const result = await services.store.getEffectivePracticeWithPackRoots(root, id);
        if (result === undefined) {
          throw new CliError(
            cliErrorCodes.practiceNotFound,
            "The requested Practice was not found in the selected local Store.",
          );
        }
        return {
          data: {
            practice: result.effectivePractice.practice,
            contentDigest: result.effectivePractice.contentDigest,
            sources: result.sources.map(({ packName, sourcePath, packRoot }) => ({
              packName,
              sourcePath,
              packRoot,
            })),
          },
        };
      } catch (error) {
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
    },
  };
}
