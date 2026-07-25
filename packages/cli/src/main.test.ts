import { expect, test } from "bun:test";

import { run } from "./main.js";
import { protocolResponseSchema, toolVersion } from "./output/protocol.js";
import { validateProtocolSchema } from "./output/protocol-schema.test-helper.js";

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
    data: {
      name: "lore",
      commands: [{ name: "describe" }],
    },
  });
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
      errorCodes: ["usage.invalid", "runtime.unexpected"],
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
