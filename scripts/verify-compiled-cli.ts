import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { protocolResponseSchema } from "../packages/cli/src/output/protocol.js";

const [binary, expectedPlatform, expectedArchitecture] = process.argv.slice(2);
if (binary === undefined || expectedPlatform === undefined || expectedArchitecture === undefined) {
  throw new Error("Usage: bun scripts/verify-compiled-cli.ts <binary> <platform> <architecture>");
}
if (process.platform !== expectedPlatform || process.arch !== expectedArchitecture) {
  throw new Error("Runner platform or architecture does not match the CI matrix expectation.");
}

const directory = await mkdtemp(join(tmpdir(), "lorelum-binary-"));
try {
  const packDirectory = join(directory, "pack");
  await mkdir(packDirectory);
  await writeFile(join(packDirectory, "pack.yaml"), "name: binary-pack\nversion: 1.0.0\n");

  await assertResponse([binary], 0, "describe");
  await assertResponse([binary, "--version"], 0, "version");
  await assertResponse([binary, "describe", "validate"], 0, "describe");
  await assertResponse([binary, "config", "path"], 0, "config.path");
  await assertResponse([binary, "validate", packDirectory], 0, "validate");
  const invalid = await run([binary, "--private-token"]);
  if (invalid.exitCode !== 2 || invalid.stderr !== "" || invalid.stdout.includes("private-token")) {
    throw new Error("Invalid invocation did not preserve the public protocol boundary.");
  }
  assertEnvelope(invalid.stdout, "unknown");
} finally {
  await rm(directory, { force: true, recursive: true });
}

async function assertResponse(
  command: string[],
  exitCode: number,
  expectedCommand: string,
): Promise<void> {
  const response = await run(command);
  if (response.exitCode !== exitCode || response.stderr !== "") {
    throw new Error(`Compiled binary fixture failed for ${expectedCommand}.`);
  }
  assertEnvelope(response.stdout, expectedCommand);
}

function assertEnvelope(stdout: string, expectedCommand: string): void {
  const lines = stdout.trimEnd().split("\n");
  if (lines.length !== 1)
    throw new Error("Compiled binary wrote more than one stdout protocol line.");
  const envelope = JSON.parse(lines[0] ?? "") as { command?: string };
  if (envelope.command !== expectedCommand || !matchesProtocolSchema(envelope)) {
    throw new Error("Compiled binary response does not match the protocol schema.");
  }
}

function matchesProtocolSchema(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return protocolResponseSchema.oneOf.some((branch) =>
    branch.required.every((property) => property in record),
  );
}

async function run(command: string[]) {
  const child = Bun.spawn({ cmd: command, stderr: "pipe", stdout: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { exitCode, stderr, stdout };
}
