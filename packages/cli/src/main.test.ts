import { expect, test } from "bun:test";

import { isInternalBackendDaemonLaunch, isInternalBackendServeInvocation, run } from "./main.js";
import { protocolResponseSchema, toolVersion, type JsonSchema } from "./output/protocol.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "./output/protocol-schema.test-helper.js";
import { describeCommand } from "./registry.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

test("recognizes only the exact private backend daemon invocation", () => {
  expect(isInternalBackendServeInvocation(["--internal-backend-serve"])).toBe(true);
  expect(isInternalBackendServeInvocation([])).toBe(false);
  expect(isInternalBackendServeInvocation(["--internal-backend-serve", "extra"])).toBe(false);
  expect(isInternalBackendServeInvocation(["backend", "start"])).toBe(false);
});

test("requires private lifecycle environment before entering the backend daemon", () => {
  const args = ["--internal-backend-serve"];
  expect(isInternalBackendDaemonLaunch(args, {})).toBe(false);
  expect(
    isInternalBackendDaemonLaunch(args, {
      LORELUM_BACKEND_DIRECTORY: "/tmp/lorelum",
      LORELUM_BACKEND_INSTANCE: "instance",
      LORELUM_BACKEND_PORT: "26186",
    }),
  ).toBe(true);
});

test("returns machine-readable root capability discovery", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run([], { stderr, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    protocolVersion: 1,
    toolVersion,
    command: "describe",
    ok: true,
    data: {
      name: "lore",
      commands: [
        { name: "describe" },
        { name: "pack.install" },
        { name: "pack.update" },
        { name: "pack.remove" },
        { name: "get" },
        { name: "query" },
        { name: "pack.list" },
        { name: "backend.start" },
        { name: "backend.status" },
        { name: "backend.stop" },
        { name: "model.load" },
        { name: "model.status" },
        { name: "model.unload" },
        { name: "index.status" },
        { name: "index.build" },
        { name: "index.rebuild" },
        { name: "index.operation" },
        { name: "format" },
        { name: "i18n.sync" },
        { name: "validate" },
      ],
    },
  });
  expect(stderr.value).toBe("");
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, resultSchemaFor("lore"))).toEqual([]);
  expect(
    validateJsonSchema({ ...response.data, commands: "describe" }, resultSchemaFor("lore")),
  ).not.toEqual([]);
});

test("returns command metadata through describe", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["describe", "describe"], { stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "describe",
    ok: true,
    data: {
      name: "describe",
      resultSchema: { oneOf: expect.any(Array) },
      errorCodes: [
        "usage.invalid",
        "usage.format-invalid",
        "usage.format-conflict",
        "usage.format-unsupported",
        "runtime.unexpected",
      ],
      exitCodes: [0, 2],
    },
  });
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  expect(validateJsonSchema(response.data, resultSchemaFor("describe"))).toEqual([]);
  expect(
    validateJsonSchema({ ...response.data, exitCodes: ["0", "2"] }, resultSchemaFor("describe")),
  ).not.toEqual([]);
});

function resultSchemaFor(command: string): JsonSchema {
  const description = describeCommand(command) as { resultSchema?: JsonSchema } | undefined;
  if (description?.resultSchema === undefined) {
    throw new Error(`Missing result schema for ${command}`);
  }
  return description.resultSchema;
}

function optionResultSchemaFor(command: string, behavior: string): JsonSchema {
  const description = describeCommand(command) as
    | {
        options?: readonly {
          behavior?: string;
          response?: { resultSchema?: JsonSchema };
        }[];
      }
    | undefined;
  const schema = description?.options?.find((option) => option.behavior === behavior)?.response
    ?.resultSchema;
  if (schema === undefined) {
    throw new Error(`Missing ${behavior} result schema for ${command}`);
  }
  return schema;
}

test("returns plain-text help and structured version responses", async () => {
  const help = new MemoryWriter();
  const version = new MemoryWriter();

  expect(await run(["describe", "--help"], { stdout: help })).toBe(0);
  expect(help.value).toContain("Usage: lore describe");
  expect(help.value).toContain("Return machine-readable command capabilities.");
  expect(help.value).not.toContain('"protocolVersion"');

  expect(await run(["--version"], { stdout: version })).toBe(0);
  const versionResponse = JSON.parse(version.value);
  expect(versionResponse).toEqual({
    protocolVersion: 1,
    toolVersion,
    command: "version",
    ok: true,
    data: { protocolVersion: 1, toolVersion },
  });
  expect(validateProtocolSchema(versionResponse, protocolResponseSchema)).toEqual([]);
  const versionResultSchema = optionResultSchemaFor("lore", "version");
  expect(validateJsonSchema(versionResponse.data, versionResultSchema)).toEqual([]);
  expect(validateJsonSchema({ protocolVersion: 1 }, versionResultSchema)).not.toEqual([]);

  const textVersion = new MemoryWriter();
  const textStderr = new MemoryWriter();
  expect(
    await run(["--version", "--format=text"], { stdout: textVersion, stderr: textStderr }),
  ).toBe(0);
  expect(textVersion.value).toBe(`Lorelum ${toolVersion} (protocol 1)\n`);
  expect(textStderr.value).toBe("");
});

test("Help remains plain text regardless of format selectors", async () => {
  const invocations = [
    ["--help", "--human"],
    ["--help", "--json"],
    ["--format=json", "--help"],
    ["describe", "--format=text", "--help"],
    ["query", "probe", "--human", "--help"],
    ["query", "probe", "--json", "--help"],
    ["get", "--help"],
    ["query", "--help"],
    ["query", "-h"],
    ["pack", "install", "--help"],
    ["describe", "-h"],
    ["pack", "--help"],
    ["help", "query"],
    ["help", "pack"],
  ];
  await Promise.all(
    invocations.map(async (args) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();
      expect(await run(args, { stdout, stderr })).toBe(0);
      expect(stdout.value).toContain("Usage: lore");
      expect(stdout.value).not.toContain('"ok"');
      expect(stderr.value).toBe("");
    }),
  );
  const queryHelp = new MemoryWriter();
  expect(await run(["help", "query"], { stdout: queryHelp })).toBe(0);
  expect(queryHelp.value).toContain("Usage: lore query <text>");
  expect(queryHelp.value).toContain("--format <format>");
  const packGroupHelp = new MemoryWriter();
  expect(await run(["help", "pack"], { stdout: packGroupHelp })).toBe(0);
  expect(packGroupHelp.value).toContain("Subcommands:");
  expect(packGroupHelp.value).toContain("pack install <pack[@version]>");
});

test("accepts the documented equals form of global options", async () => {
  const stdout = new MemoryWriter();

  expect(await run(["--log-level=debug"], { stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "describe", ok: true });
});

test("accepts JSON and agent format selectors without changing JSON output", async () => {
  await Promise.all(
    [["--format=json"], ["--json"], ["--agent"], ["describe", "--agent"]].map(async (args) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run(args, { stderr, stdout })).toBe(0);
      expect(JSON.parse(stdout.value)).toMatchObject({ ok: true });
      expect(stderr.value).toBe("");
    }),
  );
});

test("rejects invalid, conflicting, and unsupported output format requests before handlers", async () => {
  const cases = [
    { args: ["get", "placeholder", "--format=csv"], command: "get", code: "usage.format-invalid" },
    { args: ["get", "--format"], command: "get", code: "usage.format-invalid" },
    {
      args: ["get", "placeholder", "--json", "--human"],
      command: "get",
      code: "usage.format-conflict",
    },
    {
      args: ["describe", "--format=text"],
      command: "describe",
      code: "usage.format-unsupported",
    },
    {
      args: ["describe", "--agent", "--format=text"],
      command: "describe",
      code: "usage.format-unsupported",
    },
    {
      args: ["query", "probe", "--human", "--json", "--help"],
      command: "query",
      code: "usage.format-conflict",
    },
    { args: ["--format=text"], command: "lore", code: "usage.format-unsupported" },
  ] as const;

  await Promise.all(
    cases.map(async ({ args, command, code }) => {
      const stdout = new MemoryWriter();
      const stderr = new MemoryWriter();

      expect(await run([...args], { stderr, stdout })).toBe(2);
      expect(JSON.parse(stdout.value)).toMatchObject({
        command,
        ok: false,
        error: { code },
      });
      expect(stdout.value.trimEnd().split("\n")).toHaveLength(1);
      expect(stderr.value).toBe("");
    }),
  );
});

test("uses a text diagnostic only for an unknown command with explicit text preference", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run(["not-a-command", "--human"], { stderr, stdout })).toBe(2);
  expect(stdout.value).toBe("");
  expect(stderr.value).toBe("error[usage.invalid]: The command invocation is invalid.\n");
});

test("routes a recognized text-capable command's invocation failure to stderr", async () => {
  const stdout = new MemoryWriter();
  const stderr = new MemoryWriter();

  expect(await run(["query", "--format=text"], { stdout, stderr })).toBe(2);
  expect(stdout.value).toBe("");
  expect(stderr.value).toBe("error[usage.invalid]: The command invocation is invalid.\n");
});

test("validates invalid calls before help and version responses", async () => {
  const invalidCalls = [
    ["unknown", "--help"],
    ["describe", "unknown", "--help"],
    ["unknown", "--version"],
    ["--help", "--version"],
    ["describe", "--version"],
    ["--log-level"],
    ["--store-root"],
    ["pack", "install", "agentic-coding", "--store-root="],
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
