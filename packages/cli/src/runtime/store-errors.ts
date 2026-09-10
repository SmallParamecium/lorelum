import { StoreBusyError, StoreRecoveryRequiredError } from "@lorelum/engine";

import { CliError, cliErrorCodes, frameworkErrorCodes } from "./errors.js";

/** Error allowlist shared by commands that read the LocalStore. */
export const storeReadErrorCodes = Object.freeze([
  ...frameworkErrorCodes,
  cliErrorCodes.storeBusy,
  cliErrorCodes.storeRecoveryRequired,
]);

export function toStoreCliError(error: unknown): CliError | undefined {
  if (error instanceof StoreBusyError) {
    return new CliError(cliErrorCodes.storeBusy, "The local Pack store is busy.");
  }
  if (error instanceof StoreRecoveryRequiredError) {
    return new CliError(
      cliErrorCodes.storeRecoveryRequired,
      "The local Pack store requires recovery.",
    );
  }
  return undefined;
}

/**
 * Re-throw an already-mapped CliError or a LocalStore failure verbatim; fall
 * through to the original error otherwise. Shared by retrieval commands.
 */
export function throwVisibleStoreError(error: unknown): never {
  if (error instanceof CliError) throw error;
  const storeError = toStoreCliError(error);
  if (storeError !== undefined) throw storeError;
  throw error;
}
