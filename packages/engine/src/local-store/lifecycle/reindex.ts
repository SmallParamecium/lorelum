import { rm } from "node:fs/promises";

import type { LocalStoreRepository } from "../../persistence/repositories/local-store";
import { diffEffectivePractices } from "../model";
import { rebuildEffectivePracticesFromManifest } from "../storage/artifacts/rebuild";
import { syncCurrentPackLocators } from "../storage/artifacts/current-locator";
import { SqliteStateError, StoreRecoveryRequiredError } from "../storage/errors";
import {
  clearOperationJournal,
  createOperationJournalRecord,
  listOperationJournals,
  writeOperationJournal,
} from "../storage/journal/operation-journal";
import {
  readManifest,
  writeManifest,
  type InstalledPacksManifest,
} from "../storage/manifest/manifest-store";
import { acquireMutationLock } from "../storage/mutation-lock";
import { openLocalStoreRepository, sqlitePath } from "../storage/sqlite/database";
import { resetLegacyStoreUnderLock } from "../storage/sqlite/legacy-reset";

import { deliverRevisionNotifications } from "./mutation";
import { nextStoreCounter } from "./counters";
import { runStoreRecovery } from "./recovery";
import type { EffectiveRevisionHook, ReindexResult } from "./types";

function withFreshRevision(manifest: InstalledPacksManifest): InstalledPacksManifest {
  return Object.freeze({
    schemaVersion: manifest.schemaVersion,
    generation: nextStoreCounter(manifest.generation, "generation"),
    effectiveRevision: nextStoreCounter(manifest.effectiveRevision, "effectiveRevision"),
    packs: manifest.packs,
  });
}

function sqliteErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) return undefined;
    if ("code" in current && typeof current.code === "string") return current.code;
    current = "rootCause" in current ? current.rootCause : undefined;
  }
  return undefined;
}

function sqliteErrorMessage(error: unknown): string {
  let current: unknown = error;
  const messages: string[] = [];
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) break;
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "rootCause" in current ? current.rootCause : undefined;
  }
  return messages.join(": ");
}

function isRebuildableStructuralError(error: unknown): boolean {
  const code = sqliteErrorCode(error);
  if (code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") return true;
  return /no such (?:table|column)|malformed database schema/i.test(sqliteErrorMessage(error));
}

async function recreateDatabase(rootPath: string) {
  await Promise.all(
    ["", "-wal", "-shm"].map((suffix) => rm(sqlitePath(rootPath) + suffix, { force: true })),
  );
  return openLocalStoreRepository(rootPath);
}

async function openDatabaseForReindex(rootPath: string) {
  try {
    return await openLocalStoreRepository(rootPath);
  } catch (error) {
    if (!isRebuildableStructuralError(error)) throw error;
    // Only positively identified corruption is destructive. Unsupported newer
    // schemas, permissions, locks, and generic I/O errors are preserved.
    return recreateDatabase(rootPath);
  }
}

/**
 * Re-derive the whole store from the active manifest's snapshots (ADR 0007
 * §8). `reindex` is the recovery entry point and bypasses cold open: it
 * succeeds precisely where `open()` fails. It takes the active manifest's
 * Pack snapshots as its only input, re-runs format validation and derived-data
 * construction, generates a fresh `effectiveRevision`, and never scans or
 * revives historical artifacts.
 */
export async function reindexStore(
  rootPath: string,
  hook: EffectiveRevisionHook | undefined,
): Promise<ReindexResult> {
  const committed = await (async () => {
    const lock = await acquireMutationLock(rootPath);
    let repository: LocalStoreRepository | undefined;
    try {
      // Reindex writes its own fresh full-refresh notification below, so a
      // baseline reset here only hydrates the new SQLite projection.
      await resetLegacyStoreUnderLock(rootPath, { fullRefresh: false });
      const priorJournalIds = await listOperationJournals(rootPath);
      repository = await openDatabaseForReindex(rootPath);
      try {
        repository.readLocalStoreSnapshot();
      } catch (error) {
        if (isRebuildableStructuralError(error)) {
          repository.close();
          repository = undefined;
          repository = await recreateDatabase(rootPath);
        } else if (!(error instanceof SqliteStateError)) {
          throw error;
        }
        // Non-structural derived-content errors are overwritten below.
      }

      // A readable old tuple can deterministically converge an interrupted
      // mutation before reindex selects its authoritative manifest. If SQLite is
      // missing/inconsistent, reindex intentionally falls back to the current
      // active manifest and supersedes the old journals only after the rebuild
      // commits successfully.
      let manifest: InstalledPacksManifest;
      try {
        manifest = (await runStoreRecovery(rootPath, repository)).manifest;
      } catch (error) {
        if (
          !(error instanceof StoreRecoveryRequiredError) &&
          !(error instanceof SqliteStateError)
        ) {
          throw error;
        }
        manifest = await readManifest(rootPath);
      }

      // Rebuild solely from manifest-referenced, digest-verified Pack
      // artifacts. The same authority check is used for legacy baseline reset.
      const effectivePractices = await rebuildEffectivePracticesFromManifest(rootPath, manifest);

      // Reindex is a recovery boundary, not a normal revision delta. The
      // outbox still notifies hooks of the complete current corpus, while the
      // retained index history is deliberately cleared so every derived-index
      // checkpoint from before recovery must take its existing full path.
      const delta = diffEffectivePractices([], effectivePractices);
      const targetManifest = withFreshRevision(manifest);
      const shouldQueueNotification =
        hook !== undefined || repository.readPendingRevisionNotifications().length > 0;
      const journal = createOperationJournalRecord("reindex", manifest, targetManifest);
      await writeOperationJournal(rootPath, journal);
      await writeManifest(rootPath, targetManifest);
      await syncCurrentPackLocators(rootPath, targetManifest);
      const derivedState = {
        generation: targetManifest.generation,
        effectiveRevision: targetManifest.effectiveRevision,
        activePacks: targetManifest.packs,
        effectivePractices,
        revisionNotification: !shouldQueueNotification
          ? undefined
          : { delta, supersedesPending: true },
        clearRevisionLog: true,
      } as const;
      try {
        repository.writeDerivedState(derivedState);
      } catch (error) {
        if (!isRebuildableStructuralError(error)) throw error;
        repository.close();
        repository = undefined;
        repository = await recreateDatabase(rootPath);
        repository.writeDerivedState(derivedState);
      }
      await clearOperationJournal(rootPath, journal.operationId);
      for (const priorJournalId of priorJournalIds) {
        // eslint-disable-next-line no-await-in-loop -- cleanup follows commit order
        await clearOperationJournal(rootPath, priorJournalId);
      }
      return Object.freeze({
        generation: targetManifest.generation,
        effectiveRevision: targetManifest.effectiveRevision,
        delta,
        diagnostics: Object.freeze([]),
        cleanupPending: false,
      });
    } finally {
      repository?.close();
      await lock.release();
    }
  })();
  const notificationPending = await deliverRevisionNotifications(
    rootPath,
    hook,
    committed.effectiveRevision,
  );
  return Object.freeze({ ...committed, notificationPending });
}
