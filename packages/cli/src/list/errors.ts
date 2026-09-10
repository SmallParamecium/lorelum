import { UnknownPackError } from "@lorelum/engine";

import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { storeReadErrorCodes, throwVisibleStoreError } from "../runtime/store-errors.js";

/** Error allowlist for the LocalStore-backed catalog command (`lore list`). */
export const listErrorCodes = Object.freeze([
  ...storeReadErrorCodes,
  cliErrorCodes.listPackNotFound,
]);

/** Convert engine domain errors to visible CLI errors; returns undefined when not one. */
export function toListCliError(error: unknown): CliError | undefined {
  if (error instanceof UnknownPackError) {
    return new CliError(cliErrorCodes.listPackNotFound, "The requested Pack is not installed.");
  }
  return undefined;
}

/** Re-throw a mapped CliError, a list domain error, or a store error verbatim. */
export function throwListVisibleError(error: unknown): never {
  const listError = toListCliError(error);
  if (listError !== undefined) throw listError;
  throwVisibleStoreError(error);
}
