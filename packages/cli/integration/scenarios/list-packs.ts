import assert from "node:assert/strict";
import { join } from "node:path";

import type { InstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runList } from "../support/commands.js";
import {
  parseSingleResponse,
  requireFailureCode,
  requireSuccessData,
} from "../support/protocol.js";

/** Verify the legacy catalog and the `list packs` metadata view. */
export async function verifyListPacksScenario(
  compiledBinary: string,
  fixture: InstalledPacksFixture,
  workingDirectory: string,
): Promise<void> {
  const listed = await runList(compiledBinary, fixture.storageRoot);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.stderr, "");
  assert.deepEqual(requireSuccessData(parseSingleResponse(listed.stdout), "list").packs, [
    { name: "integration-pack", version: "1.0.0", practiceCount: 2 },
    { name: "minimal-pack", version: "1.0.0", practiceCount: 1 },
  ]);

  const details = await runList(compiledBinary, fixture.storageRoot, { scope: "packs" });
  assert.equal(details.exitCode, 0);
  assert.equal(details.stderr, "");
  assert.deepEqual(requireSuccessData(parseSingleResponse(details.stdout), "list").packs, [
    {
      name: "integration-pack",
      version: "1.0.0",
      description: "Process integration fixture.",
      appliesTo: ["bun", "typescript"],
    },
    { name: "minimal-pack", version: "1.0.0", appliesTo: [] },
  ]);

  const catalog = await runList(compiledBinary, fixture.storageRoot, {
    packName: "integration-pack",
  });
  assert.equal(catalog.exitCode, 0);
  assert.equal(catalog.stderr, "");
  const catalogData = requireSuccessData(parseSingleResponse(catalog.stdout), "list");
  assert.deepEqual(catalogData.pack, { name: "integration-pack", version: "1.0.0" });
  assert(Array.isArray(catalogData.practices));
  assert(
    catalogData.practices.some(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        value.id === fixture.primaryPracticeId,
    ),
  );

  const emptyStoreRoot = join(workingDirectory, "empty-list-store");
  const emptyCatalog = await runList(compiledBinary, emptyStoreRoot);
  assert.equal(emptyCatalog.exitCode, 0);
  assert.deepEqual(requireSuccessData(parseSingleResponse(emptyCatalog.stdout), "list").packs, []);

  const emptyDetails = await runList(compiledBinary, emptyStoreRoot, { scope: "packs" });
  assert.equal(emptyDetails.exitCode, 0);
  assert.equal(emptyDetails.stderr, "");
  assert.deepEqual(requireSuccessData(parseSingleResponse(emptyDetails.stdout), "list").packs, []);

  const missingPack = await runList(compiledBinary, fixture.storageRoot, {
    packName: "missing-pack",
  });
  assert.equal(missingPack.exitCode, 2);
  requireFailureCode(parseSingleResponse(missingPack.stdout), "list", "list.pack-not-found");
}
