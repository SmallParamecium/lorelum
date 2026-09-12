import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createInstalledPacksFixture } from "./fixtures/installed-packs.js";
import { verifyGetAndQueryScenario } from "./scenarios/get-query.js";
import { verifyListPacksScenario } from "./scenarios/list-packs.js";
import { runProcess } from "./support/process.js";
import { selectProtocolFields } from "./support/protocol.js";

const entrypoint = join(import.meta.dir, "../src/main.ts");

async function main(): Promise<void> {
  const bunExecutable = Bun.which("bun");
  if (bunExecutable === null)
    throw new Error("Bun executable is required for CLI integration tests.");

  await verifySourceEntrypoint(bunExecutable);
  const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
  try {
    const executable = join(directory, process.platform === "win32" ? "lore.exe" : "lore");
    await compileCli(bunExecutable, executable);
    await verifyCompiledEntrypoint(executable, directory);

    const fixture = await createInstalledPacksFixture(directory);
    await verifyListPacksScenario(executable, fixture, directory);
    await verifyGetAndQueryScenario(executable, fixture, directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

async function verifySourceEntrypoint(bunExecutable: string): Promise<void> {
  const source = await runProcess([bunExecutable, entrypoint, "--version"]);
  assert.equal(source.exitCode, 0);
  assert.deepEqual(selectProtocolFields(source.stdout), { command: "version", ok: true });
  assert.equal(source.stderr, "");

  const hiddenWithoutGrant = await runProcess([
    bunExecutable,
    entrypoint,
    "--internal-backend-serve",
  ]);
  assert.equal(hiddenWithoutGrant.exitCode, 2);
  assert.deepEqual(selectProtocolFields(hiddenWithoutGrant.stdout), {
    command: "unknown",
    errorCode: "usage.invalid",
    ok: false,
  });
  assert.equal(hiddenWithoutGrant.stderr, "");
}

async function compileCli(bunExecutable: string, executable: string): Promise<void> {
  const build = await runProcess([
    bunExecutable,
    "build",
    "--compile",
    entrypoint,
    "--outfile",
    executable,
  ]);
  assert.equal(build.exitCode, 0, build.stderr || build.stdout);
}

async function verifyCompiledEntrypoint(executable: string, directory: string): Promise<void> {
  const binary = await runProcess([executable, "--version"]);
  assert.equal(binary.exitCode, 0);
  assert.deepEqual(selectProtocolFields(binary.stdout), { command: "version", ok: true });
  assert.equal(binary.stderr, "");

  const discovery = await runProcess([executable]);
  assert.equal(discovery.exitCode, 0);
  assert.deepEqual(selectProtocolFields(discovery.stdout), { command: "describe", ok: true });
  assert.equal(discovery.stderr, "");

  const isolatedDiscovery = await runProcess([
    executable,
    "--store-root",
    join(directory, "worktree-store"),
  ]);
  assert.equal(isolatedDiscovery.exitCode, 0);
  assert.deepEqual(selectProtocolFields(isolatedDiscovery.stdout), {
    command: "describe",
    ok: true,
  });
  assert.equal(isolatedDiscovery.stderr, "");

  const invalid = await runProcess([executable, "--private-token"]);
  assert.equal(invalid.exitCode, 2);
  assert.deepEqual(selectProtocolFields(invalid.stdout), {
    command: "unknown",
    errorCode: "usage.invalid",
    ok: false,
  });
  assert.equal(invalid.stdout.includes("private-token"), false);
  assert.equal(invalid.stderr, "");
}

if (import.meta.main) await main();
