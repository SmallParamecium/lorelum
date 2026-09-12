import { expect, test } from "bun:test";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  UnknownPackError,
  defaultStorageRoot,
  type ListPackRequest,
  type ListRequest,
  type ListService,
} from "@lorelum/engine";
import { resolve } from "node:path";

import { run } from "../main.js";
import { validateJsonSchema } from "../output/protocol-schema.test-helper.js";
import type { JsonSchema } from "../output/protocol.js";
import { commandRegistry, describeCommand, snapshotCommandDefinitions } from "../registry.js";
import type { CommandDefinition } from "../registry.js";
import { CliError, cliErrorCodes } from "../runtime/errors.js";
import { createListCommand } from "./list-command.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const packsResult = {
  generation: 1,
  effectiveRevision: 2,
  packs: [
    { name: "agentic-coding", version: "0.3.0", practiceCount: 31 },
    { name: "platform", version: "1.0.0", practiceCount: 0 },
  ],
};

const packResult = {
  generation: 1,
  effectiveRevision: 2,
  pack: { name: "agentic-coding", version: "0.3.0" },
  practices: [
    {
      id: "agentic-coding.testing.classify-failure-before-changing-test",
      title: "Classify the Failure Before Changing the Test",
      applies_when: "a focused test fails and the next action would modify the test",
    },
  ],
};

const packDetailsResult = {
  generation: 1,
  effectiveRevision: 2,
  packs: [
    {
      name: "agentic-coding",
      version: "0.3.0",
      description: "Agentic coding practices.",
      applies_to: ["typescript"],
    },
    {
      name: "platform",
      version: "1.0.0",
    },
  ],
};

function service(overrides: Partial<ListService> = {}): ListService {
  return {
    async list() {
      return packsResult;
    },
    async listPackDetails() {
      return packDetailsResult;
    },
    async listPack() {
      return packResult;
    },
    ...overrides,
  };
}

function failingService(error: unknown): ListService {
  const fail = async (): Promise<never> => {
    throw error;
  };
  return service({ list: fail, listPackDetails: fail, listPack: fail });
}

test("describes the LocalStore-backed list command contract", () => {
  expect(describeCommand("list")).toMatchObject({
    name: "list",
    usage: "list [scope]",
    positionals: [{ name: "scope", required: false, values: ["packs"] }],
    options: [
      { name: "-h, --help", required: false },
      { name: "--log-level <level>", required: false },
      { name: "--store-root <path>", required: false },
      { name: "--pack <name>", required: false },
    ],
    errorCodes: [
      "usage.invalid",
      "runtime.unexpected",
      "store.busy",
      "store.recovery-required",
      "list.pack-not-found",
    ],
    exitCodes: [0, 2],
  });
});

test("returns all list modes through their result schema", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({ list: service(), storageRoot: defaultStorageRoot() }),
  ]);

  expect(await run(["list"], { registry: definitions, stdout })).toBe(0);
  let response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ command: "list", ok: true, data: packsResult });
  let description = describeCommand("list") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);

  stdout.value = "";
  expect(await run(["list", "--pack", "agentic-coding"], { registry: definitions, stdout })).toBe(
    0,
  );
  response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ command: "list", ok: true, data: packResult });
  description = describeCommand("list") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);

  stdout.value = "";
  expect(await run(["list", "packs"], { registry: definitions, stdout })).toBe(0);
  response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "list",
    ok: true,
    data: {
      generation: 1,
      effectiveRevision: 2,
      packs: [
        {
          name: "agentic-coding",
          version: "0.3.0",
          description: "Agentic coding practices.",
          appliesTo: ["typescript"],
        },
        { name: "platform", version: "1.0.0", appliesTo: [] },
      ],
    },
  });
  description = describeCommand("list") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);

  expect(
    validateJsonSchema({ ...packsResult, pack: packResult.pack }, description.resultSchema),
  ).not.toEqual([]);
  expect(
    validateJsonSchema({ ...packResult, packs: packsResult.packs }, description.resultSchema),
  ).not.toEqual([]);
  expect(
    validateJsonSchema(
      { generation: 0, effectiveRevision: 0, packs: [] },
      description.resultSchema,
    ),
  ).toEqual([]);
});

test("rejects conflicting and unknown list scopes before service dispatch", async () => {
  const calls: string[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({
      list: service({
        async list() {
          calls.push("list");
          return packsResult;
        },
        async listPackDetails() {
          calls.push("listPackDetails");
          return packDetailsResult;
        },
        async listPack() {
          calls.push("listPack");
          return packResult;
        },
      }),
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  const invocations = [
    { args: ["list", "unknown"], command: "unknown" },
    { args: ["list", "packs", "--pack", "agentic-coding"], command: "list" },
  ];
  const results = await Promise.all(
    invocations.map(async ({ args, command }) => {
      const stdout = new MemoryWriter();
      return {
        command,
        exitCode: await run(args, { registry: definitions, stdout }),
        response: JSON.parse(stdout.value),
      };
    }),
  );
  for (const { command, exitCode, response } of results) {
    expect(exitCode).toBe(2);
    expect(response).toMatchObject({
      command,
      ok: false,
      error: { code: "usage.invalid" },
    });
  }
  expect(calls).toEqual([]);
});

test("rejects malformed Pack names before service dispatch", async () => {
  const calls: string[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({
      list: service({
        async list(request = {}) {
          calls.push(`list:${request.storageRoot?.rootPath ?? "default"}`);
          return packsResult;
        },
        async listPack(request) {
          calls.push(`listPack:${request.packName}`);
          return packResult;
        },
      }),
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  const results = await Promise.all(
    ["", "   ", "Agentic", "agentic_coding", "agentic--coding"].map(async (packName) => {
      const stdout = new MemoryWriter();
      const exitCode = await run(["list", "--pack", packName], { registry: definitions, stdout });
      return { exitCode, response: JSON.parse(stdout.value) };
    }),
  );
  for (const { exitCode, response } of results) {
    expect(exitCode).toBe(2);
    expect(response).toMatchObject({
      command: "list",
      ok: false,
      error: { code: "usage.invalid" },
    });
  }
  expect(calls).toEqual([]);
});

test("rejects an empty --store-root value before service dispatch", async () => {
  const calls: string[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({
      list: service({
        async list(request = {}) {
          calls.push(`list:${request.storageRoot?.rootPath}`);
          return packsResult;
        },
        async listPack() {
          calls.push("listPack");
          return packResult;
        },
      }),
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  const stdout = new MemoryWriter();
  expect(await run(["list", "--store-root", ""], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "list",
    ok: false,
    error: { code: "usage.invalid" },
  });
  expect(calls).toEqual([]);
});

test("maps an unknown Pack without echoing the supplied name", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({
      list: service({
        async listPack() {
          throw new UnknownPackError("private-pack-name");
        },
      }),
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  expect(
    await run(["list", "--pack", "private-pack-name"], { registry: definitions, stdout }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "list",
    ok: false,
    error: {
      code: "list.pack-not-found",
      message: "The requested Pack is not installed.",
    },
  });
  expect(stdout.value).not.toContain("private-pack-name");
});

async function expectListFailure(
  list: ListService,
  args: readonly string[],
  error: Record<string, unknown>,
): Promise<void> {
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions([
    createListCommand({ list, storageRoot: defaultStorageRoot() }),
  ]);
  expect(await run([...args], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "list", ok: false, error });
}

const listModeArguments = [["list"], ["list", "packs"], ["list", "--pack", "agentic-coding"]];

test("maps LocalStore recovery failures from every list mode", async () => {
  const list = failingService(new StoreRecoveryRequiredError("test recovery failure"));
  await Promise.all(
    listModeArguments.map((args) =>
      expectListFailure(list, args, { code: "store.recovery-required" }),
    ),
  );
});

test("maps LocalStore busy failures from every list mode", async () => {
  const list = failingService(new StoreBusyError("test busy failure"));
  await Promise.all(
    listModeArguments.map((args) => expectListFailure(list, args, { code: "store.busy" })),
  );
});

test("normalizes undeclared list failures without exposing their details", async () => {
  const stdout = new MemoryWriter();
  const definitions = snapshotCommandDefinitions([
    createListCommand({
      list: failingService(new Error("private list implementation detail")),
      storageRoot: defaultStorageRoot(),
    }),
  ]);

  expect(await run(["list", "packs"], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "list",
    ok: false,
    error: {
      code: "runtime.unexpected",
      message: "The command could not be completed.",
    },
  });
  expect(stdout.value).not.toContain("private list implementation detail");
});

test("passes through declared CliErrors from the list service", async () => {
  await expectListFailure(
    failingService(new CliError(cliErrorCodes.usageInvalid, "The list request was rejected.")),
    ["list", "packs"],
    { code: "usage.invalid", message: "The list request was rejected." },
  );
});

test("resolves --store-root and forwards the selected Store to every list mode", async () => {
  const listRequests: ListRequest[] = [];
  const richListRequests: ListRequest[] = [];
  const listPackRequests: ListPackRequest[] = [];
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({
      list: service({
        async list(request = {}) {
          listRequests.push(request);
          return packsResult;
        },
        async listPackDetails(request = {}) {
          richListRequests.push(request);
          return packDetailsResult;
        },
        async listPack(request) {
          listPackRequests.push(request);
          return packResult;
        },
      }),
      storageRoot: { rootPath: "default-user-store" },
    }),
  ]);

  await Promise.all(
    [
      ["list", "--store-root", "isolated-store"],
      ["list", "packs", "--store-root", "isolated-store"],
      ["list", "--pack", "agentic-coding", "--store-root", "isolated-store"],
    ].map(async (args) => {
      const stdout = new MemoryWriter();
      expect(await run(args, { registry: definitions, stdout })).toBe(0);
    }),
  );

  const expectedRoot = { rootPath: resolve(process.cwd(), "isolated-store") };
  expect(listRequests[0]?.storageRoot).toEqual(expectedRoot);
  expect(richListRequests[0]?.storageRoot).toEqual(expectedRoot);
  expect(listPackRequests[0]?.storageRoot).toEqual(expectedRoot);
  expect(listPackRequests[0]?.packName).toBe("agentic-coding");
});

test("list is included in the production command registry", () => {
  expect(commandRegistry.map((definition) => definition.name)).toContain("list");
});
