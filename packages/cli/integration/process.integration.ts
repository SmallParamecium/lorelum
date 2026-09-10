import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalStore, decodePackDirectory } from "@lorelum/engine";

const entrypoint = join(import.meta.dir, "../src/main.ts");
const bunExecutable = Bun.which("bun");
const processTimeoutMs = 60_000;

async function writeLocalStoreFixturePack(directory: string): Promise<string> {
  const packRoot = join(directory, "localstore-fixture-pack");
  const practices = join(packRoot, "practices", "react");
  await mkdir(practices, { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), "name: integration-query-get\nversion: 0.1.0\n");
  await writeFile(
    join(practices, "api-client.md"),
    [
      "---",
      "id: react.api-client",
      "title: Layer React API access",
      "stage: api-layer",
      "tech_stack: [react, typescript]",
      "applies_when: adding remote requests to a React interface",
      "severity: warn",
      "---",
      "Keep transport, DTO translation, and expected failures behind a feature API boundary.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(practices, "resource-state.md"),
    [
      "---",
      "id: react.resource-state",
      "title: Separate resource and UI state",
      "stage: state",
      "tech_stack: [react, typescript]",
      "applies_when: storing remote resource data used by a React interface",
      "severity: warn",
      "---",
      "Model resource data separately from view state and transform DTOs at the boundary.",
      "",
    ].join("\n"),
  );
  return packRoot;
}

async function writeEmptyPracticePack(directory: string): Promise<string> {
  const packRoot = join(directory, "empty-practice-pack");
  await mkdir(join(packRoot, "practices"), { recursive: true });
  await writeFile(join(packRoot, "pack.yaml"), "name: empty-practice-pack\nversion: 0.1.0\n");
  return packRoot;
}

if (bunExecutable === null) {
  throw new Error("Bun executable is required for CLI integration tests.");
}

await assert.rejects(
  runProcess([bunExecutable, "-e", "setInterval(() => undefined, 1_000);"], 100),
  /Process timed out after 100 ms:/,
);

const source = await runProcess([bunExecutable, entrypoint, "--version"]);
assert.equal(source.exitCode, 0);
assert.deepEqual(selectProtocolFields(source.stdout), { command: "version", ok: true });
assert.equal(source.stderr, "");

const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
const executable = join(directory, process.platform === "win32" ? "lore.exe" : "lore");

try {
  const build = await runProcess([
    bunExecutable,
    "build",
    "--compile",
    entrypoint,
    "--outfile",
    executable,
  ]);
  assert.equal(build.exitCode, 0);

  const binary = await runProcess([executable, "--version"]);
  assert.equal(binary.exitCode, 0);
  assert.deepEqual(selectProtocolFields(binary.stdout), { command: "version", ok: true });
  assert.equal(binary.stderr, "");

  const packRoot = await writeLocalStoreFixturePack(directory);
  const decoded = await decodePackDirectory(packRoot);
  const storeRoot = { rootPath: join(directory, "store") };
  await createLocalStore().install(storeRoot, decoded.candidate, decoded.diagnostics);

  const list = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "list",
  ]);
  assert.equal(list.exitCode, 0);
  const listResponse: unknown = JSON.parse(list.stdout);
  assert(isRecord(listResponse));
  assert.equal(listResponse.command, "list");
  assert.equal(listResponse.ok, true);
  assert(isRecord(listResponse.data));
  assert.equal(listResponse.data.generation, 1);
  assert.equal(listResponse.data.effectiveRevision, 1);
  assert(Array.isArray(listResponse.data.packs));
  assert.deepEqual(listResponse.data.packs, [
    { name: "integration-query-get", version: "0.1.0", practiceCount: 2 },
  ]);
  assert.equal(list.stderr, "");

  const listPack = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "list",
    "--pack",
    "integration-query-get",
  ]);
  assert.equal(listPack.exitCode, 0);
  const listPackResponse: unknown = JSON.parse(listPack.stdout);
  assert(isRecord(listPackResponse));
  assert.equal(listPackResponse.command, "list");
  assert.equal(listPackResponse.ok, true);
  assert(isRecord(listPackResponse.data));
  assert.deepEqual(listPackResponse.data.pack, {
    name: "integration-query-get",
    version: "0.1.0",
  });
  assert.deepEqual(listPackResponse.data.practices, [
    {
      id: "react.api-client",
      title: "Layer React API access",
      applies_when: "adding remote requests to a React interface",
    },
    {
      id: "react.resource-state",
      title: "Separate resource and UI state",
      applies_when: "storing remote resource data used by a React interface",
    },
  ]);
  assert.equal(listPack.stderr, "");

  const listedPractice = listPackResponse.data.practices[0];
  assert(isRecord(listedPractice));
  assert(typeof listedPractice.id === "string");

  const query = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "query",
    "remote requests React interface",
  ]);
  assert.equal(query.exitCode, 0);
  const queryResponse: unknown = JSON.parse(query.stdout);
  assert(isRecord(queryResponse));
  assert.equal(queryResponse.command, "query");
  assert.equal(queryResponse.ok, true);
  assert(isRecord(queryResponse.data));
  assert.equal(queryResponse.data.total, 2);
  assert(Array.isArray(queryResponse.data.results));
  assert.equal(queryResponse.data.results[0]?.id, "react.api-client");
  assert.equal(query.stderr, "");

  const get = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "get",
    listedPractice.id,
  ]);
  assert.equal(get.exitCode, 0);
  const getResponse: unknown = JSON.parse(get.stdout);
  assert(isRecord(getResponse));
  assert.equal(getResponse.command, "get");
  assert.equal(getResponse.ok, true);
  assert(isRecord(getResponse.data));
  assert(isRecord(getResponse.data.practice));
  assert.equal(getResponse.data.practice.id, listedPractice.id);
  assert.equal(getResponse.data.practice.title, "Layer React API access");
  assert.equal(
    getResponse.data.practice.body,
    "Keep transport, DTO translation, and expected failures behind a feature API boundary.\n",
  );
  assert.equal(get.stderr, "");

  const emptyPracticePackRoot = await writeEmptyPracticePack(directory);
  const emptyPracticePack = await decodePackDirectory(emptyPracticePackRoot);
  const emptyPracticeStoreRoot = { rootPath: join(directory, "empty-practice-store") };
  await createLocalStore().install(
    emptyPracticeStoreRoot,
    emptyPracticePack.candidate,
    emptyPracticePack.diagnostics,
  );

  const emptyPracticeList = await runProcess([
    executable,
    "--store-root",
    emptyPracticeStoreRoot.rootPath,
    "list",
  ]);
  assert.equal(emptyPracticeList.exitCode, 0);
  const emptyPracticeListResponse: unknown = JSON.parse(emptyPracticeList.stdout);
  assert(isRecord(emptyPracticeListResponse));
  assert(isRecord(emptyPracticeListResponse.data));
  assert.deepEqual(emptyPracticeListResponse.data.packs, [
    { name: "empty-practice-pack", version: "0.1.0", practiceCount: 0 },
  ]);
  assert.equal(emptyPracticeList.stderr, "");

  const emptyPracticeCatalog = await runProcess([
    executable,
    "--store-root",
    emptyPracticeStoreRoot.rootPath,
    "list",
    "--pack",
    "empty-practice-pack",
  ]);
  assert.equal(emptyPracticeCatalog.exitCode, 0);
  const emptyPracticeCatalogResponse: unknown = JSON.parse(emptyPracticeCatalog.stdout);
  assert(isRecord(emptyPracticeCatalogResponse));
  assert(isRecord(emptyPracticeCatalogResponse.data));
  assert.deepEqual(emptyPracticeCatalogResponse.data.pack, {
    name: "empty-practice-pack",
    version: "0.1.0",
  });
  assert.deepEqual(emptyPracticeCatalogResponse.data.practices, []);
  assert.equal(emptyPracticeCatalog.stderr, "");

  const emptyStoreRoot = join(directory, "empty-store");
  const emptyList = await runProcess([
    executable,
    "--store-root",
    emptyStoreRoot,
    "list",
  ]);
  assert.equal(emptyList.exitCode, 0);
  const emptyListResponse: unknown = JSON.parse(emptyList.stdout);
  assert(isRecord(emptyListResponse));
  assert.equal(emptyListResponse.command, "list");
  assert.equal(emptyListResponse.ok, true);
  assert(isRecord(emptyListResponse.data));
  assert.deepEqual(emptyListResponse.data.packs, []);
  assert.equal(emptyList.stderr, "");

  const missingPack = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "list",
    "--pack",
    "missing-pack",
  ]);
  assert.equal(missingPack.exitCode, 2);
  assert.deepEqual(selectProtocolFields(missingPack.stdout), {
    command: "list",
    errorCode: "list.pack-not-found",
    ok: false,
  });
  assert.equal(missingPack.stdout.includes("missing-pack"), false);
  assert.equal(missingPack.stderr, "");

  const emptyQuery = await runProcess([
    executable,
    "--store-root",
    emptyStoreRoot,
    "query",
    "remote requests",
  ]);
  assert.equal(emptyQuery.exitCode, 0);
  const emptyQueryResponse: unknown = JSON.parse(emptyQuery.stdout);
  assert(isRecord(emptyQueryResponse));
  assert.equal(emptyQueryResponse.command, "query");
  assert.equal(emptyQueryResponse.ok, true);
  assert(isRecord(emptyQueryResponse.data));
  assert.equal(emptyQueryResponse.data.total, 0);
  assert.deepEqual(emptyQueryResponse.data.results, []);
  assert.equal(emptyQuery.stderr, "");

  const unknown = await runProcess([
    executable,
    "--store-root",
    storeRoot.rootPath,
    "get",
    "react.missing",
  ]);
  assert.equal(unknown.exitCode, 2);
  assert.deepEqual(selectProtocolFields(unknown.stdout), {
    command: "get",
    errorCode: "get.unknown_practice",
    ok: false,
  });
  assert.equal(unknown.stderr, "");

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
} finally {
  await rm(directory, { force: true, recursive: true });
}

function selectProtocolFields(stdout: string): {
  command: unknown;
  errorCode?: unknown;
  ok: unknown;
} {
  const response: unknown = JSON.parse(stdout);
  assert(isRecord(response));

  const error = response.error;
  return {
    command: response.command,
    ...(isRecord(error) ? { errorCode: error.code } : {}),
    ok: response.ok,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function runProcess(
  command: string[],
  timeoutMs = processTimeoutMs,
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = Bun.spawn({ cmd: command, stderr: "pipe", stdout: "pipe" });
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const executableName = command[0] ?? "<missing executable>";
      try {
        child.kill();
      } catch (error) {
        reject(
          new Error(
            `Process timed out after ${timeoutMs} ms and could not be terminated: ${executableName}`,
            { cause: error },
          ),
        );
        return;
      }
      reject(new Error(`Process timed out after ${timeoutMs} ms: ${executableName}`));
    }, timeoutMs);
  });

  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]),
      timeout,
    ]);
    return { exitCode, stderr, stdout };
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
