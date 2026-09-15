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

test("describes the LocalStore-backed Pack catalog command contract", () => {
  expect(describeCommand("pack.list")).toMatchObject({
    name: "pack.list",
    usage: "pack list [pack]",
    positionals: [{ name: "pack", required: false }],
    options: [
      { name: "-h, --help", required: false },
      { name: "--format <format>", required: false, values: ["json", "text"] },
      { name: "--json", required: false },
      { name: "--human", required: false },
      { name: "--agent", required: false },
      { name: "--log-level <level>", required: false },
      { name: "--store-root <path>", required: false },
      { name: "--details", required: false },
    ],
    output: { formats: ["json", "text"], default: "json" },
    errorCodes: [
      "usage.invalid",
      "usage.format-invalid",
      "usage.format-conflict",
      "usage.format-unsupported",
      "runtime.unexpected",
      "store.busy",
      "store.recovery-required",
      "pack.not-installed",
    ],
    exitCodes: [0, 2],
  });
});

test("returns all list modes through their result schema", async () => {
  const stdout = new MemoryWriter();
  const definitions: readonly CommandDefinition[] = snapshotCommandDefinitions([
    createListCommand({ list: service(), storageRoot: defaultStorageRoot() }),
  ]);

  expect(await run(["pack", "list"], { registry: definitions, stdout })).toBe(0);
  let response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ command: "pack.list", ok: true, data: packsResult });
  let description = describeCommand("pack.list") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);

  const textOutput = new MemoryWriter();
  expect(
    await run(["pack", "list", "--format=text"], { registry: definitions, stdout: textOutput }),
  ).toBe(0);
  expect(textOutput.value).toContain("Store snapshot: generation 1, effective revision 2");
  expect(textOutput.value).toContain("agentic-coding@0.3.0 (31 Practices)");
  expect(textOutput.value).not.toContain('"ok"');

  const catalogText = new MemoryWriter();
  expect(
    await run(["pack", "list", "agentic-coding", "--human"], {
      registry: definitions,
      stdout: catalogText,
    }),
  ).toBe(0);
  expect(catalogText.value).toContain("agentic-coding@0.3.0");
  expect(catalogText.value).toContain("agentic-coding.testing");
  expect(catalogText.value).not.toContain('"ok"');

  stdout.value = "";
  expect(await run(["pack", "list", "agentic-coding"], { registry: definitions, stdout })).toBe(0);
  response = JSON.parse(stdout.value);
  expect(response).toMatchObject({ command: "pack.list", ok: true, data: packResult });
  description = describeCommand("pack.list") as { resultSchema: JsonSchema };
  expect(validateJsonSchema(response.data, description.resultSchema)).toEqual([]);

  stdout.value = "";
  expect(await run(["pack", "list", "--details"], { registry: definitions, stdout })).toBe(0);
  response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "pack.list",
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
  description = describeCommand("pack.list") as { resultSchema: JsonSchema };
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

test("rejects conflicting or extra Pack catalog arguments before service dispatch", async () => {
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
    { args: ["pack", "list", "agentic-coding", "extra"], command: "pack.list" },
    { args: ["pack", "list", "agentic-coding", "--details"], command: "pack.list" },
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
      const exitCode = await run(["pack", "list", packName], { registry: definitions, stdout });
      return { exitCode, response: JSON.parse(stdout.value) };
    }),
  );
  for (const { exitCode, response } of results) {
    expect(exitCode).toBe(2);
    expect(response).toMatchObject({
      command: "pack.list",
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
  expect(await run(["pack", "list", "--store-root", ""], { registry: definitions, stdout })).toBe(
    2,
  );
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "pack.list",
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

  expect(await run(["pack", "list", "private-pack-name"], { registry: definitions, stdout })).toBe(
    2,
  );
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "pack.list",
    ok: false,
    error: {
      code: "pack.not-installed",
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
  expect(JSON.parse(stdout.value)).toMatchObject({ command: "pack.list", ok: false, error });
}

const listModeArguments = [
  ["pack", "list"],
  ["pack", "list", "--details"],
  ["pack", "list", "agentic-coding"],
];

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

  expect(await run(["pack", "list", "--details"], { registry: definitions, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "pack.list",
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
    ["pack", "list", "--details"],
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
      ["pack", "list", "--store-root", "isolated-store"],
      ["pack", "list", "--details", "--store-root", "isolated-store"],
      ["pack", "list", "agentic-coding", "--store-root", "isolated-store"],
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

test("Pack catalog is included in the production command registry", () => {
  expect(commandRegistry.map((definition) => definition.name)).toContain("pack.list");
});
