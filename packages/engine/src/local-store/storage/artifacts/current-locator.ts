import { lstat, mkdir, readdir, realpath, symlink, unlink } from "node:fs/promises";
import { join } from "node:path";

import { StoreRecoveryRequiredError } from "../errors";
import type {
  InstalledPackManifestEntry,
  InstalledPacksManifest,
} from "../manifest/manifest-store";

import { artifactPath } from "./artifact-store";

const STORAGE_KEY_REGEX = /^p-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** An otherwise healthy Store needs its derived public locator reconciled. */
export class CurrentPackLocatorRepairNeededError extends Error {
  constructor(readonly storageKey: string) {
    super(`current Pack locator needs repair for ${storageKey}`);
    this.name = "CurrentPackLocatorRepairNeededError";
  }
}

/** The only public filesystem root returned for an active Pack. */
export function currentPackRoot(rootPath: string, storageKey: string): string {
  if (!STORAGE_KEY_REGEX.test(storageKey)) {
    throw new StoreRecoveryRequiredError("active Pack storage key is unsafe");
  }
  return join(rootPath, "packs", storageKey, "current");
}

async function expectedArtifactRoot(
  rootPath: string,
  entry: InstalledPackManifestEntry,
): Promise<string> {
  try {
    return await realpath(artifactPath(rootPath, entry.storageKey, entry.artifactDigest));
  } catch {
    throw new StoreRecoveryRequiredError(`active artifact is missing for ${entry.storageKey}`);
  }
}

async function currentResolvesTo(
  rootPath: string,
  entry: InstalledPackManifestEntry,
): Promise<boolean> {
  try {
    const [expected, actual] = await Promise.all([
      expectedArtifactRoot(rootPath, entry),
      realpath(currentPackRoot(rootPath, entry.storageKey)),
    ]);
    return actual === expected;
  } catch (error) {
    if (error instanceof StoreRecoveryRequiredError) throw error;
    return false;
  }
}

/** Verify a public locator without treating it as a source of Pack truth. */
export async function verifiedCurrentPackRoot(
  rootPath: string,
  entry: InstalledPackManifestEntry,
): Promise<string> {
  if (!(await currentResolvesTo(rootPath, entry))) {
    throw new CurrentPackLocatorRepairNeededError(entry.storageKey);
  }
  return currentPackRoot(rootPath, entry.storageKey);
}

async function replaceCurrentPackLocator(
  rootPath: string,
  entry: InstalledPackManifestEntry,
): Promise<void> {
  const current = currentPackRoot(rootPath, entry.storageKey);
  if (await currentResolvesTo(rootPath, entry)) return;

  try {
    const existing = await lstat(current);
    if (!existing.isSymbolicLink()) {
      throw new StoreRecoveryRequiredError(
        `public current locator is not a link for ${entry.storageKey}`,
      );
    }
    await unlink(current);
  } catch (error) {
    if (error instanceof StoreRecoveryRequiredError) throw error;
    if (
      !(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
    ) {
      throw new StoreRecoveryRequiredError(
        `cannot inspect current locator for ${entry.storageKey}`,
      );
    }
  }

  await mkdir(join(rootPath, "packs", entry.storageKey), { recursive: true });
  const target =
    process.platform === "win32"
      ? await expectedArtifactRoot(rootPath, entry)
      : entry.artifactDigest;
  try {
    await symlink(target, current, process.platform === "win32" ? "junction" : "dir");
  } catch {
    throw new StoreRecoveryRequiredError(`cannot publish current locator for ${entry.storageKey}`);
  }
  if (!(await currentResolvesTo(rootPath, entry))) {
    throw new StoreRecoveryRequiredError(
      `published current locator is invalid for ${entry.storageKey}`,
    );
  }
}

/** Remove a derived locator after its Pack is no longer active. */
export async function removeCurrentPackLocator(
  rootPath: string,
  storageKey: string,
): Promise<void> {
  const current = currentPackRoot(rootPath, storageKey);
  try {
    const existing = await lstat(current);
    if (!existing.isSymbolicLink()) {
      throw new StoreRecoveryRequiredError(
        `public current locator is not a link for ${storageKey}`,
      );
    }
    await unlink(current);
  } catch (error) {
    if (error instanceof StoreRecoveryRequiredError) throw error;
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw new StoreRecoveryRequiredError(`cannot remove current locator for ${storageKey}`);
  }
}

/**
 * Reconcile the public, derived views from the authoritative active manifest.
 * It does not mutate the manifest, SQLite tuple, revision log, or artifacts.
 */
export async function syncCurrentPackLocators(
  rootPath: string,
  manifest: InstalledPacksManifest,
): Promise<void> {
  const active = new Set(manifest.packs.map((entry) => entry.storageKey));
  await Promise.all(manifest.packs.map((entry) => replaceCurrentPackLocator(rootPath, entry)));

  const entries = await readdir(join(rootPath, "packs"), {
    encoding: "utf8",
    withFileTypes: true,
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new StoreRecoveryRequiredError("cannot enumerate current Pack locators");
  });
  if (entries === undefined) return;
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() && STORAGE_KEY_REGEX.test(entry.name) && !active.has(entry.name),
      )
      .map((entry) => removeCurrentPackLocator(rootPath, entry.name)),
  );
}
