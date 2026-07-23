import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { run } from "./main.js";
import { protocolResponseSchema, toolVersion } from "./output/protocol.js";
import { validateProtocolSchema } from "./output/protocol-schema.test-helper.js";
import { createRuntime } from "./runtime/runtime.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("returns machine-readable root capability discovery", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run([], { stderr, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: { name: "lore" },
  });
  expect(
    JSON.parse(stdout.value).data.commands.map((command: { name: string }) => command.name),
  ).toEqual(expect.arrayContaining(["describe", "config", "config.path", "config.show"]));
  expect(stderr.value).toBe("");
  expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
});

test("returns command metadata through describe", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["describe", "describe"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "describe",
      resultSchema: { type: "object" },
      errorCodes: expect.arrayContaining(["usage.invalid", "runtime.unexpected"]),
      exitCodes: [0, 2],
    },
  });
  expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
});

test("returns structured help and version responses", async () => {
  const help = new MemoryWriter();
  const version = new MemoryWriter();

  expect(await run(["describe", "--help"], { stdout: help })).toBe(0);
  expect(JSON.parse(help.value)).toMatchObject({
    command: "describe",
    ok: true,
    data: { name: "describe" },
  });
  expect(validateProtocolSchema(JSON.parse(help.value), protocolResponseSchema)).toEqual([]);

  expect(await run(["--version"], { stdout: version })).toBe(0);
  expect(JSON.parse(version.value)).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "version",
    ok: true,
    data: { protocolVersion: 1, toolVersion },
  });
  expect(validateProtocolSchema(JSON.parse(version.value), protocolResponseSchema)).toEqual([]);
});

test("accepts the documented equals form of global options", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["--log-level=debug"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "describe", ok: true });
});

test("validates invalid calls before help and version responses", async () => {
  const invalidCalls = [
    ["unknown", "--help"],
    ["describe", "unknown", "--help"],
    ["unknown", "--version"],
    ["--log-level"],
    ["--private-token"],
  ];
  await Promise.all(
    invalidCalls.map(async (args) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(args, { stderr, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        ok: false,
        error: { code: "usage.invalid", message: "The command invocation is invalid." },
      });
      expect(stdout.value).not.toContain("private-token");
      expect(stderr.value).toBe("");
      expect(validateProtocolSchema(JSON.parse(stdout.value), protocolResponseSchema)).toEqual([]);
    }),
  );
});

test("reports deterministic local configuration paths and defaults", async () => {
  const stdout = new MemoryWriter();
  const runtime = createRuntime({
    env: { XDG_CONFIG_HOME: "/home/agent/.config-root" },
    homeDirectory: "/ignored",
    platform: "linux",
  });

  expect(await run(["config", "path"], { runtime, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "config.path",
    ok: true,
    data: { path: "/home/agent/.config-root/lorelum/config.json", source: "default" },
  });

  const show = new MemoryWriter();
  const missingRuntime = createRuntime({
    env: { LORELUM_CONFIG: join("/tmp", "lorelum-config-does-not-exist.json") },
    platform: "linux",
  });
  expect(await run(["config", "show"], { runtime: missingRuntime, stdout: show })).toBe(2);
  expect(JSON.parse(show.value)).toMatchObject({
    command: "config.show",
    ok: false,
    error: { code: "config.unreadable" },
  });
});

test("loads an explicitly selected configuration through the CLI boundary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-cli-"));
  const path = join(directory, "config.json");
  await writeFile(path, '{"version":1}');
  const stdout = new MemoryWriter();

  try {
    expect(await run([`--config=${path}`, "config", "show"], { stdout })).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "config.show",
      ok: true,
      data: { configuration: { version: 1 }, source: "file" },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
