import assert from "node:assert/strict";
import { join } from "node:path";

import type { InstalledPacksFixture } from "../fixtures/installed-packs.js";
import { runList } from "../support/commands.js";
import {
  parseSingleResponse,
  requireFailureCode,
  requireSuccessData,
} from "../support/protocol.js";

/** Verify the Pack catalog and its rich metadata view. */
export async function verifyListPacksScenario(
  compiledBinary: string,
  fixture: InstalledPacksFixture,
  workingDirectory: string,
): Promise<void> {
  const listed = await runList(compiledBinary, fixture.storageRoot);
  assert.equal(listed.exitCode, 0);
  assert.equal(listed.stderr, "");
  assert.deepEqual(requireSuccessData(parseSingleResponse(listed.stdout), "pack.list").packs, [
    { name: "integration-pack", version: "1.0.0", practiceCount: 2 },
    { name: "minimal-pack", version: "1.0.0", practiceCount: 1 },
  ]);

  const listedText = await runList(compiledBinary, fixture.storageRoot, { format: "text" });
  assert.equal(listedText.exitCode, 0);
  assert.equal(listedText.stderr, "");
  assert(listedText.stdout.includes("Store snapshot: generation"));
  assert(listedText.stdout.includes("integration-pack@1.0.0 (2 Practices)"));
  assert.equal(listedText.stdout.includes('"ok"'), false);

  const details = await runList(compiledBinary, fixture.storageRoot, { details: true });
  assert.equal(details.exitCode, 0);
  assert.equal(details.stderr, "");
  assert.deepEqual(requireSuccessData(parseSingleResponse(details.stdout), "pack.list").packs, [
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
  const catalogData = requireSuccessData(parseSingleResponse(catalog.stdout), "pack.list");
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

  const catalogText = await runList(compiledBinary, fixture.storageRoot, {
    packName: "integration-pack",
    format: "text",
  });
  assert.equal(catalogText.exitCode, 0);
  assert.equal(catalogText.stderr, "");
  assert(catalogText.stdout.includes(fixture.primaryPracticeId));
  assert.equal(catalogText.stdout.includes('"ok"'), false);

  const emptyStoreRoot = join(workingDirectory, "empty-list-store");
  const emptyCatalog = await runList(compiledBinary, emptyStoreRoot);
  assert.equal(emptyCatalog.exitCode, 0);
  assert.deepEqual(
    requireSuccessData(parseSingleResponse(emptyCatalog.stdout), "pack.list").packs,
    [],
  );

  const emptyDetails = await runList(compiledBinary, emptyStoreRoot, { details: true });
  assert.equal(emptyDetails.exitCode, 0);
  assert.equal(emptyDetails.stderr, "");
  assert.deepEqual(
    requireSuccessData(parseSingleResponse(emptyDetails.stdout), "pack.list").packs,
    [],
  );

  const missingPack = await runList(compiledBinary, fixture.storageRoot, {
    packName: "missing-pack",
  });
  assert.equal(missingPack.exitCode, 2);
  requireFailureCode(parseSingleResponse(missingPack.stdout), "pack.list", "pack.not-installed");
}
