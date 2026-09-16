import { and, desc, eq, inArray } from "drizzle-orm";
import { access, mkdir, stat } from "node:fs/promises";
import { relative } from "node:path";

import { acquireMutationLock } from "../../local-store/storage/mutation-lock";
import { openSqliteConnection } from "../../persistence/database/connection";
import { migrateSqlite } from "../../persistence/database/migrator";
import { projectCacheDatabaseDefinition } from "../../persistence/definitions";
import {
  contentArtifactIndexes,
  contentArtifacts,
  contentArtifactSources,
} from "../../persistence/schemas/project-cache";
import { contentArtifactCachePaths } from "./cache";

const DIGEST = /^[a-f0-9]{64}$/;

export type ContentArtifactCacheArtifactKind = "keyword" | "semantic";
export type ContentArtifactCacheArtifactState = "ready" | "progress";

export interface ContentArtifactCacheArtifactRecord {
  readonly artifactId: string;
  readonly kind: ContentArtifactCacheArtifactKind;
  readonly profileId?: string;
  readonly corpusDigest: string;
  /** Opaque current-source slot used only for bounded predecessor lookup. */
  readonly sourceSlotId?: string;
  /** Optional source-local Store revision; never a filesystem locator. */
  readonly sourceRevision?: number;
  readonly documentCount: number;
  readonly state: ContentArtifactCacheArtifactState;
  /** Must point at a generated cache file, never a source file. */
  readonly filePath: string;
  readonly verified: boolean;
}

export interface ContentArtifactCacheCatalogStatus {
  readonly artifactCount: number;
  readonly keywordArtifactCount: number;
  readonly semanticArtifactCount: number;
}

function validRecord(record: ContentArtifactCacheArtifactRecord): boolean {
  return (
    DIGEST.test(record.artifactId) &&
    DIGEST.test(record.corpusDigest) &&
    (record.profileId === undefined || DIGEST.test(record.profileId)) &&
    (record.sourceSlotId === undefined || DIGEST.test(record.sourceSlotId)) &&
    (record.sourceRevision === undefined ||
      (record.sourceSlotId !== undefined &&
        Number.isSafeInteger(record.sourceRevision) &&
        record.sourceRevision >= 0)) &&
    Number.isSafeInteger(record.documentCount) &&
    record.documentCount >= 0
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function withCatalogWriter<T>(cacheRoot: string, work: () => Promise<T>): Promise<T> {
  const paths = contentArtifactCachePaths(cacheRoot);
  await mkdir(paths.catalogWriter, { recursive: true });
  const lock = await acquireMutationLock(paths.catalogWriter);
  try {
    return await work();
  } finally {
    await lock.release();
  }
}

function safeRelativeArtifactPath(cacheRoot: string, filePath: string): string | undefined {
  const prefix = contentArtifactCachePaths(cacheRoot).artifacts;
  const path = relative(prefix, filePath).replaceAll("\\", "/");
  if (
    !/^(keyword|semantic)\/[a-f0-9]{64}\/(active|progress)\.sqlite$/.test(path) ||
    path.startsWith("../")
  ) {
    return undefined;
  }
  return path;
}

/** Best-effort catalog write. A failure never invalidates an already verified artifact. */
export async function recordContentArtifactCacheArtifact(
  cacheRoot: string,
  record: ContentArtifactCacheArtifactRecord,
): Promise<void> {
  if (!validRecord(record) || !(await exists(record.filePath))) return;
  const relativePath = safeRelativeArtifactPath(cacheRoot, record.filePath);
  if (relativePath === undefined) return;
  let fileSize: number;
  try {
    fileSize = (await stat(record.filePath)).size;
  } catch {
    return;
  }
  try {
    await withCatalogWriter(cacheRoot, async () => {
      const paths = contentArtifactCachePaths(cacheRoot);
      await mkdir(paths.directory, { recursive: true });
      const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema);
      try {
        migrateSqlite(connection, projectCacheDatabaseDefinition);
        const timestamp = new Date().toISOString();
        connection.orm.transaction(() => {
          connection.orm
            .insert(contentArtifacts)
            .values({
              artifactId: record.artifactId,
              kind: record.kind,
              ...(record.profileId === undefined ? {} : { profileId: record.profileId }),
              corpusDigest: record.corpusDigest,
              documentCount: record.documentCount,
              createdAt: timestamp,
              lastAccessedAt: timestamp,
            })
            .onConflictDoUpdate({
              target: contentArtifacts.artifactId,
              set: {
                kind: record.kind,
                ...(record.profileId === undefined
                  ? { profileId: null }
                  : { profileId: record.profileId }),
                corpusDigest: record.corpusDigest,
                documentCount: record.documentCount,
                lastAccessedAt: timestamp,
              },
            })
            .run();
          if (record.sourceSlotId !== undefined) {
            connection.orm
              .insert(contentArtifactSources)
              .values({
                artifactId: record.artifactId,
                sourceSlotId: record.sourceSlotId,
                ...(record.sourceRevision === undefined
                  ? {}
                  : { sourceRevision: record.sourceRevision }),
                lastAccessedAt: timestamp,
              })
              .onConflictDoUpdate({
                target: [contentArtifactSources.artifactId, contentArtifactSources.sourceSlotId],
                set: {
                  ...(record.sourceRevision === undefined
                    ? { sourceRevision: null }
                    : { sourceRevision: record.sourceRevision }),
                  lastAccessedAt: timestamp,
                },
              })
              .run();
          }
          connection.orm
            .insert(contentArtifactIndexes)
            .values({
              artifactId: record.artifactId,
              state: record.state,
              relativePath,
              byteSize: fileSize,
              publishedAt: timestamp,
              ...(record.verified ? { verifiedAt: timestamp } : {}),
            })
            .onConflictDoUpdate({
              target: [contentArtifactIndexes.artifactId, contentArtifactIndexes.state],
              set: {
                relativePath,
                byteSize: fileSize,
                publishedAt: timestamp,
                ...(record.verified ? { verifiedAt: timestamp } : { verifiedAt: null }),
              },
            })
            .run();
        });
      } finally {
        connection.close();
      }
    });
  } catch {
    // The artifact remains usable and its next access can repopulate the
    // advisory catalog. Never fail a current query because bookkeeping lost a race.
  }
}

export async function removeContentArtifactCacheArtifactRecords(
  cacheRoot: string,
  artifactIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(artifactIds.filter((id) => DIGEST.test(id)))];
  if (ids.length === 0) return;
  const paths = contentArtifactCachePaths(cacheRoot);
  if (!(await exists(paths.catalog))) return;
  try {
    await withCatalogWriter(cacheRoot, async () => {
      const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema);
      try {
        migrateSqlite(connection, projectCacheDatabaseDefinition);
        connection.orm
          .delete(contentArtifacts)
          .where(inArray(contentArtifacts.artifactId, ids))
          .run();
      } finally {
        connection.close();
      }
    });
  } catch {
    // Leftover metadata is harmless and will be reconciled by the next record.
  }
}

export async function contentArtifactCacheCatalogStatus(
  cacheRoot: string,
): Promise<ContentArtifactCacheCatalogStatus> {
  const paths = contentArtifactCachePaths(cacheRoot);
  if (!(await exists(paths.catalog))) {
    return { artifactCount: 0, keywordArtifactCount: 0, semanticArtifactCount: 0 };
  }
  try {
    const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema, {
      readonly: true,
    });
    try {
      const rows = connection.orm
        .select({ kind: contentArtifacts.kind })
        .from(contentArtifacts)
        .all();
      return {
        artifactCount: rows.length,
        keywordArtifactCount: rows.filter((row) => row.kind === "keyword").length,
        semanticArtifactCount: rows.filter((row) => row.kind === "semantic").length,
      };
    } finally {
      connection.close();
    }
  } catch {
    return { artifactCount: 0, keywordArtifactCount: 0, semanticArtifactCount: 0 };
  }
}

/**
 * Return a bounded predecessor set for one opaque source slot. The catalog is
 * advisory, so stale rows merely suppress reuse instead of affecting the
 * canonical current query.
 */
export async function recentContentArtifactIds(
  cacheRoot: string,
  input: {
    readonly kind: ContentArtifactCacheArtifactKind;
    readonly sourceSlotId: string;
    readonly limit: number;
  },
): Promise<readonly string[]> {
  if (!DIGEST.test(input.sourceSlotId) || !Number.isSafeInteger(input.limit) || input.limit < 1) {
    return Object.freeze([]);
  }
  const paths = contentArtifactCachePaths(cacheRoot);
  if (!(await exists(paths.catalog))) return Object.freeze([]);
  try {
    const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema, {
      readonly: true,
    });
    try {
      const rows = connection.orm
        .select({ artifactId: contentArtifacts.artifactId })
        .from(contentArtifactSources)
        .innerJoin(
          contentArtifacts,
          eq(contentArtifactSources.artifactId, contentArtifacts.artifactId),
        )
        .where(
          and(
            eq(contentArtifacts.kind, input.kind),
            eq(contentArtifactSources.sourceSlotId, input.sourceSlotId),
          ),
        )
        .orderBy(desc(contentArtifactSources.lastAccessedAt))
        .limit(input.limit)
        .all();
      return Object.freeze(
        rows.map((row) => row.artifactId).filter((artifactId) => DIGEST.test(artifactId)),
      );
    } finally {
      connection.close();
    }
  } catch {
    return Object.freeze([]);
  }
}

/**
 * Return bounded, non-canonical predecessor metadata for a source slot. The
 * caller must still verify the artifact and source continuity before reuse.
 */
export interface ContentArtifactCachePredecessor {
  readonly artifactId: string;
  readonly corpusDigest: string;
  readonly documentCount: number;
  readonly sourceRevision?: number;
}

export async function recentContentArtifactPredecessors(
  cacheRoot: string,
  input: {
    readonly kind: ContentArtifactCacheArtifactKind;
    readonly sourceSlotId: string;
    readonly limit: number;
  },
): Promise<readonly ContentArtifactCachePredecessor[]> {
  if (!DIGEST.test(input.sourceSlotId) || !Number.isSafeInteger(input.limit) || input.limit < 1) {
    return Object.freeze([]);
  }
  const paths = contentArtifactCachePaths(cacheRoot);
  if (!(await exists(paths.catalog))) return Object.freeze([]);
  try {
    const connection = openSqliteConnection(paths.catalog, projectCacheDatabaseDefinition.schema, {
      readonly: true,
    });
    try {
      const rows = connection.orm
        .select({
          artifactId: contentArtifacts.artifactId,
          corpusDigest: contentArtifacts.corpusDigest,
          documentCount: contentArtifacts.documentCount,
          sourceRevision: contentArtifactSources.sourceRevision,
        })
        .from(contentArtifactSources)
        .innerJoin(
          contentArtifacts,
          eq(contentArtifactSources.artifactId, contentArtifacts.artifactId),
        )
        .where(
          and(
            eq(contentArtifacts.kind, input.kind),
            eq(contentArtifactSources.sourceSlotId, input.sourceSlotId),
          ),
        )
        .orderBy(desc(contentArtifactSources.lastAccessedAt))
        .limit(input.limit)
        .all();
      return Object.freeze(
        rows.flatMap((row) => {
          if (
            !DIGEST.test(row.artifactId) ||
            !DIGEST.test(row.corpusDigest) ||
            !Number.isSafeInteger(row.documentCount) ||
            row.documentCount < 0 ||
            (row.sourceRevision !== null &&
              (!Number.isSafeInteger(row.sourceRevision) || row.sourceRevision < 0))
          ) {
            return [];
          }
          return [
            Object.freeze({
              artifactId: row.artifactId,
              corpusDigest: row.corpusDigest,
              documentCount: row.documentCount,
              ...(row.sourceRevision === null ? {} : { sourceRevision: row.sourceRevision }),
            }),
          ];
        }),
      );
    } finally {
      connection.close();
    }
  } catch {
    return Object.freeze([]);
  }
}
