import { expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  type EffectivePractice,
} from "@lorelum/engine";

import { run } from "../main.js";
import {
  validateJsonSchema,
  validateProtocolSchema,
} from "../output/protocol-schema.test-helper.js";
import { protocolResponseSchema } from "../output/protocol.js";
import { describeCommand, snapshotCommandDefinitions } from "../registry.js";
import { CliError } from "../runtime/errors.js";
import { createGetCommand, type GetCommandServices } from "./get-command.js";

const practice = {
  id: "sample.exact-id",
  title: "Read this Practice",
  stage: "testing",
  tech_stack: ["typescript", "bun"],
  applies_when: "when verifying a requested outcome",
  severity: "warn" as const,
  body: "## Guidance\n\nKeep the full body.\n\n```ts\nassert(outcome);\n```\n",
  anti_patterns: [],
};
const canonicalContent = JSON.stringify(practice);
const contentDigest = new Bun.CryptoHasher("sha256").update(canonicalContent).digest("hex");
const effective: EffectivePractice = {
  practiceId: practice.id,
  practice,
  canonicalContent,
  contentDigest,
  sources: [
    {
      packName: "sample",
      practiceId: practice.id,
      contentDigest,
      sourcePath: "practices/exact.md",
      canonicalPractice: { practice, canonicalContent, contentDigest },
    },
  ],
};

const located = {
  effectivePractice: effective,
  sources: [
    {
      packName: "sample",
      sourcePath: "practices/exact.md",
      packRoot: "/verified-store/packs/p-sample/example",
    },
  ],
};

async function invoke(args: readonly string[], store: GetCommandServices["store"]) {
  const stdout = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const stderr = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const definition = createGetCommand({ store, storageRoot: { rootPath: "unused-default" } });
  const exitCode = await run([...args, "--json"], {
    registry: snapshotCommandDefinitions([definition]),
    stdout,
    stderr,
  });
  expect(stdout.value.endsWith("\n")).toBe(true);
  expect(stdout.value.trim().split("\n")).toHaveLength(1);
  expect(stderr.value).toBe("");
  const response = JSON.parse(stdout.value);
  expect(validateProtocolSchema(response, protocolResponseSchema)).toEqual([]);
  return { exitCode, response, definition };
}

test("returns the verified snapshot once with complete content and compact provenance", async () => {
  let reads = 0;
  const result = await invoke(["get", practice.id], {
    async getEffectivePracticeWithPackRoots(root, id) {
      reads++;
      expect(root.rootPath).toBe("unused-default");
      expect(id).toBe(practice.id);
      return located;
    },
  });
  expect(reads).toBe(1);
  expect(result.exitCode).toBe(0);
  expect(result.response.data).toEqual({
    practice,
    contentDigest,
    sources: [
      {
        packName: "sample",
        sourcePath: "practices/exact.md",
        packRoot: "/verified-store/packs/p-sample/example",
      },
    ],
  });
  expect(validateJsonSchema(result.response.data, result.definition.resultSchema)).toEqual([]);
});

async function invokeText(args: readonly string[], store: GetCommandServices["store"]) {
  const stdout = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const stderr = {
    value: "",
    write(message: string) {
      this.value += message;
    },
  };
  const definition = createGetCommand({ store, storageRoot: { rootPath: "unused-default" } });
  const exitCode = await run([...args], {
    registry: snapshotCommandDefinitions([definition]),
    stdout,
    stderr,
  });
  return { exitCode, stdout: stdout.value, stderr: stderr.value };
}

test.each([["--json", ["--json", "get", practice.id]]] as const)(
  "explicit get selector %s preserves the complete JSON caller contract",
  async (_selector, args) => {
    const result = await invoke(args, {
      async getEffectivePracticeWithPackRoots() {
        return { ...located, effectivePractice: effective };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.response).toMatchObject({ command: "get", ok: true });
    expect(result.response.data.practice.body).toBe(practice.body);
    expect(result.response.data.contentDigest).toBe(contentDigest);
    expect(validateJsonSchema(result.response.data, result.definition.resultSchema)).toEqual([]);
  },
);
test.each([
  { args: ["--store-root", "relative-store", "get", practice.id] },
  { args: ["get", practice.id, "--store-root=relative-store"] },
])("resolves explicit Store root for %j", async ({ args }) => {
  const result = await invoke(args, {
    async getEffectivePracticeWithPackRoots(root) {
      expect(root.rootPath).toBe(resolve("relative-store"));
      return located;
    },
  });
  expect(result.exitCode).toBe(0);
});

test("text get defaults to the complete Practice body", async () => {
  const result = await invokeText(["get", practice.id], {
    async getEffectivePracticeWithPackRoots() {
      return { ...located, effectivePractice: effective };
    },
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(practice.body);
  expect(result.stdout).not.toContain('"ok"');
  expect(result.stdout).not.toContain("contentDigest");
  expect(result.stderr).toBe("");
});

test("text get preserves a Practice body without a final line feed", async () => {
  const body = "## Guidance\n\nKeep the final byte exactly as authored.";
  const result = await invokeText(["get", practice.id], {
    async getEffectivePracticeWithPackRoots() {
      return {
        ...located,
        effectivePractice: {
          ...effective,
          practice: { ...effective.practice, body },
        },
      };
    },
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(body);
  expect(result.stdout.endsWith("\n")).toBe(false);
  expect(result.stderr).toBe("");
});

test("text get preserves CRLF and repeated trailing line feeds verbatim", async () => {
  const body = ["## Guidance", "", "Keep these line endings.", ""].join("\r\n") + "\r\n";
  const result = await invokeText(["get", practice.id], {
    async getEffectivePracticeWithPackRoots() {
      return {
        ...located,
        effectivePractice: {
          ...effective,
          practice: { ...effective.practice, body },
        },
      };
    },
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe(body);
  expect(result.stderr).toBe("");
});
test("text get failures go to stderr without changing the exit code", async () => {
  const result = await invokeText(["get", "sample.absent"], {
    async getEffectivePracticeWithPackRoots() {
      return undefined;
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(
    "error[practice.not-found]: The requested Practice was not found in the selected local Store.\n",
  );
});

test.each(
  [
    ["get"],
    ["get", ""],
    ["get", "sample"],
    ["get", "Sample.id"],
    ["get", "sample..id"],
    ["get", "../sample.id"],
    ["get", " sample.id"],
    ["get", "sample.id", "extra"],
    ["get", practice.id, "--store-root="],
  ].map((args) => ({ args })),
)("rejects invalid input before opening a Store: %j", async ({ args }) => {
  let opens = 0;
  const result = await invoke(args, {
    async getEffectivePracticeWithPackRoots() {
      opens++;
      throw new Error("must not open");
    },
  });
  expect(opens).toBe(0);
  expect(result.exitCode).toBe(2);
  expect(result.response.error).toEqual({
    code: "usage.invalid",
    message: "The command invocation is invalid.",
  });
});

test("does not match ID prefixes or titles", async () => {
  const result = await invoke(["get", "sample.exact"], {
    async getEffectivePracticeWithPackRoots() {
      return undefined;
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error.code).toBe("practice.not-found");
});

test.each([
  [new StoreBusyError("internal-path"), "store.busy"],
  [new StoreRecoveryRequiredError("internal-path"), "store.recovery-required"],
  [new Error("internal-path"), "runtime.unexpected"],
  [new CliError("undeclared.error", "internal-path"), "runtime.unexpected"],
] as const)("maps Store errors without exposing details: %s", async (error, code) => {
  const result = await invoke(["get", practice.id], {
    async getEffectivePracticeWithPackRoots() {
      throw error;
    },
  });
  expect(result.exitCode).toBe(2);
  expect(result.response.error.code).toBe(code);
  expect(JSON.stringify(result.response)).not.toContain("internal-path");
});

test("publishes get arguments, schema, error allowlist, and exit codes through discovery", () => {
  const definition = createGetCommand({
    store: { getEffectivePracticeWithPackRoots: async () => undefined },
    storageRoot: { rootPath: "unused-default" },
  });
  expect(describeCommand("get")).toMatchObject({
    name: "get",
    usage: "get <practice-id>",
    positionals: [{ name: "practice-id", required: true }],
    errorCodes: definition.errorCodes,
    exitCodes: [0, 2],
    output: { formats: ["json", "text"], default: "text" },
    resultSchema: definition.resultSchema,
  });
});
