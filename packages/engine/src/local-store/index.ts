/**
 * @lorelum/engine LocalStore — the stable public surface (ADR 0007 §13).
 * Only the LocalStore facade, result types, and typed errors are exported;
 * internal directories stay private to the package.
 */

export {
  createLocalStore,
  defaultStorageRoot,
  type LocalStore,
  type OpenResult,
  type InstalledPackSummary,
  type InstalledPackDetails,
  type InstalledPackDetailsResult,
  type StorageRoot,
  type StoreSnapshotIdentity,
  type EffectivePracticeSnapshot,
  type EffectivePracticeChangeSnapshot,
  type EffectivePracticeSourceLocator,
  type EffectivePracticeWithPackRoots,
} from "./lifecycle/local-store";

export {
  decodeSnapshot as decodePackDirectory,
  defaultPackDirectoryLimits,
  type DecodedSnapshot as DecodedPackDirectory,
  type PackDirectoryLimits,
} from "./storage/artifacts/snapshot-codec";

export type {
  InstallResult,
  MutationResultBase,
  ReindexResult,
  UninstallResult,
} from "./lifecycle/types";

export type { EffectiveRevisionHook } from "./lifecycle/types";

export {
  InvalidPracticeIdError,
  PackNotInstalledError,
  StoreCounterExhaustedError,
  StoreSnapshotChangedError,
  UpgradeRequiredError,
} from "./lifecycle/errors";

export {
  PackValidationError,
  PracticeConflictError,
  InvalidResourcePathError,
  InvalidSourcePathError,
  InvalidPracticeSourceError,
} from "./model/errors";

export { SnapshotFormatError, StoreBusyError, StoreRecoveryRequiredError } from "./storage/errors";

export type {
  PackCandidate,
  EffectivePractice,
  RevisionDelta,
  PackResource,
  PracticeSource,
} from "./model/types";

export { isPackResourcePath, isPracticeSourcePath } from "./model/candidate";
export { revisionDeltaPracticeIds } from "./model/effective-practices";
