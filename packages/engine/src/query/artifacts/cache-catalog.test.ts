import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { contentKeywordIndexPathsForArtifactId } from "./cache";
import {
  recentContentArtifactPredecessors,
  recordContentArtifactCacheArtifact,
} from "./cache-catalog";

const artifactId = "a".repeat(64);
const corpusDigest = "b".repeat(64);
const firstSlot = "c".repeat(64);
const secondSlot = "d".repeat(64);

test("keeps source-slot predecessor checkpoints separate for one shared artifact", async () => {
  const cacheRoot = await mkdtemp(join(tmpdir(), "lorelum-artifact-catalog-"));
  try {
    const paths = contentKeywordIndexPathsForArtifactId(cacheRoot, artifactId);
    await mkdir(dirname(paths.active), { recursive: true });
    // Catalog recording checks only that this is a generated artifact path; the
    // index reader is responsible for SQLite integrity before actual reuse.
    await writeFile(paths.active, "derived test artifact");

    await recordContentArtifactCacheArtifact(cacheRoot, {
      artifactId,
      kind: "keyword",
      corpusDigest,
      sourceSlotId: firstSlot,
      sourceRevision: 7,
      documentCount: 1,
      state: "ready",
      filePath: paths.active,
      verified: true,
    });
    await recordContentArtifactCacheArtifact(cacheRoot, {
      artifactId,
      kind: "keyword",
      corpusDigest,
      sourceSlotId: secondSlot,
      sourceRevision: 11,
      documentCount: 1,
      state: "ready",
      filePath: paths.active,
      verified: true,
    });

    await expect(
      recentContentArtifactPredecessors(cacheRoot, {
        kind: "keyword",
        sourceSlotId: firstSlot,
        limit: 2,
      }),
    ).resolves.toEqual([{ artifactId, corpusDigest, documentCount: 1, sourceRevision: 7 }]);
    await expect(
      recentContentArtifactPredecessors(cacheRoot, {
        kind: "keyword",
        sourceSlotId: secondSlot,
        limit: 2,
      }),
    ).resolves.toEqual([{ artifactId, corpusDigest, documentCount: 1, sourceRevision: 11 }]);
  } finally {
    await rm(cacheRoot, { recursive: true, force: true });
  }
});
