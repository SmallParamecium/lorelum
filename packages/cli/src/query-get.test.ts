import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PackLoadError } from "@lorelum/engine";

import { run } from "./main.js";
import { validateJsonSchema, type JsonSchema } from "./output/protocol-schema.js";
import { describeCommand } from "./registry.js";
import { createRuntime } from "./runtime/runtime.js";

class MemoryWriter {
  value = "";

  write(message: string): void {
    this.value += message;
  }
}

const practiceFixtures = [
  {
    id: "api.layered-client",
    title: "Layer the API client",
    stage: "api-layer",
    tech_stack: ["react", "typescript"],
    applies_when: "building an API layer in a React SPA",
    body: "Put HTTP calls behind a client module.",
  },
  {
    id: "state.redux",
    title: "Scale client state with Redux",
    stage: "state",
    tech_stack: ["react"],
    applies_when: "managing heavy client state",
  },
];

function runtimeForPractices(practices: unknown[]) {
  return createRuntime({
    packLoader: {
      async load() {
        return { pack: { name: "test-pack", version: "1.0.0" }, practices, decisions: [] };
      },
    },
  });
}

test("retrieves matching practices through the CLI protocol", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices(practiceFixtures);

  expect(await run(["query", "pack", "--query", "api layer react"], { runtime, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "query",
    ok: true,
    data: {
      query: "api layer react",
      total: 2,
      results: [{ id: "api.layered-client" }, { id: "state.redux" }],
    },
  });
  const resultSchema = (describeCommand("query") as { resultSchema: JsonSchema }).resultSchema;
  expect(validateJsonSchema(response.data, resultSchema)).toEqual([]);
});

test("returns an empty result when nothing matches", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices(practiceFixtures);

  expect(await run(["query", "pack", "--query", "zzz-unmatched"], { runtime, stdout })).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "query",
    ok: true,
    data: { total: 0, results: [] },
  });
});

test("returns full bodies with --full", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices(practiceFixtures);

  expect(
    await run(["query", "pack", "--query", "layer", "--full", "--top-k", "1"], {
      runtime,
      stdout,
    }),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "query",
    ok: true,
    data: {
      k: 1,
      total: 1,
      results: [{ id: "api.layered-client", body: "Put HTTP calls behind a client module." }],
    },
  });
});

test("rejects missing --query and invalid --top-k as usage errors", async () => {
  const missingQuery = new MemoryWriter();
  expect(
    await run(["query", "pack"], {
      runtime: runtimeForPractices(practiceFixtures),
      stdout: missingQuery,
    }),
  ).toBe(2);
  expect(JSON.parse(missingQuery.value)).toMatchObject({
    command: "query",
    error: { code: "usage.invalid" },
    ok: false,
  });

  const invalidRuns = await Promise.all(
    ["0", "51", "abc"].map(async (invalid) => {
      const stdout = new MemoryWriter();
      const exitCode = await run(["query", "pack", "--query", "react", "--top-k", invalid], {
        runtime: runtimeForPractices(practiceFixtures),
        stdout,
      });
      return { exitCode, parsed: JSON.parse(stdout.value) };
    }),
  );
  for (const { exitCode, parsed } of invalidRuns) {
    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({
      command: "query",
      error: { code: "usage.invalid" },
      ok: false,
    });
  }
});

test("rejects an empty query and a query-specific unknown option as usage errors", async () => {
  const emptyQuery = new MemoryWriter();
  expect(
    await run(["query", "pack", "--query", ""], {
      runtime: runtimeForPractices(practiceFixtures),
      stdout: emptyQuery,
    }),
  ).toBe(2);
  expect(JSON.parse(emptyQuery.value)).toMatchObject({
    command: "query",
    error: { code: "usage.invalid" },
    ok: false,
  });

  const unknownOption = new MemoryWriter();
  expect(
    await run(["query", "pack", "--query", "react", "--not-a-query-option"], {
      runtime: runtimeForPractices(practiceFixtures),
      stdout: unknownOption,
    }),
  ).toBe(2);
  expect(JSON.parse(unknownOption.value)).toMatchObject({
    error: { code: "usage.invalid" },
    ok: false,
  });
  expect(unknownOption.value).not.toContain("not-a-query-option");
});

test("maps query and get pack loading failures to public pack errors", async () => {
  const cases = [
    {
      code: "pack.path_invalid",
      commands: [
        ["query", "ignored", "--query", "react"],
        ["get", "ignored", "api.layered-client"],
      ],
    },
    {
      code: "pack.unreadable",
      commands: [
        ["query", "ignored", "--query", "react"],
        ["get", "ignored", "api.layered-client"],
      ],
    },
  ] as const;

  const runs = await Promise.all(
    cases.flatMap((packFailure) =>
      packFailure.commands.map(async (args) => {
        const stdout = new MemoryWriter();
        const runtime = createRuntime({
          packLoader: {
            async load() {
              throw new PackLoadError(packFailure.code, "A pack input could not be read.");
            },
          },
        });

        const exitCode = await run([...args], { runtime, stdout });
        return {
          command: args[0],
          exitCode,
          parsed: JSON.parse(stdout.value),
          expectedCode: packFailure.code,
        };
      }),
    ),
  );

  for (const { command, exitCode, expectedCode, parsed } of runs) {
    expect(exitCode).toBe(2);
    expect(parsed).toMatchObject({
      command,
      error: { code: expectedCode },
      ok: false,
    });
  }
});

test("returns one practice by id through the CLI protocol", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices(practiceFixtures);

  expect(await run(["get", "pack", "api.layered-client"], { runtime, stdout })).toBe(0);
  const response = JSON.parse(stdout.value);
  expect(response).toMatchObject({
    command: "get",
    ok: true,
    data: {
      id: "api.layered-client",
      title: "Layer the API client",
      stage: "api-layer",
      body: "Put HTTP calls behind a client module.",
    },
  });
  const resultSchema = (describeCommand("get") as { resultSchema: JsonSchema }).resultSchema;
  expect(validateJsonSchema(response.data, resultSchema)).toEqual([]);
});

test("maps an unknown practice id to get.unknown_practice", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices(practiceFixtures);

  expect(await run(["get", "pack", "state.missing"], { runtime, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "get",
    error: { code: "get.unknown_practice" },
    ok: false,
  });
});

test("maps a malformed practice document to pack.parse_error", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices([{ id: "api.malformed", stage: "api-layer" }]);

  expect(await run(["get", "pack", "api.malformed"], { runtime, stdout })).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "get",
    error: { code: "pack.parse_error" },
    ok: false,
  });
});

test("renders query results in human mode without the envelope", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForPractices(practiceFixtures);

  expect(await run(["query", "pack", "--query", "react", "--human"], { runtime, stdout })).toBe(0);
  const parsed = JSON.parse(stdout.value);
  expect(parsed).toMatchObject({ query: "react" });
  expect(stdout.value).not.toContain('"protocolVersion"');
});

test("evaluates a real explicit pack directory through the node loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-query-get-"));
  const runtime = createRuntime();

  try {
    await writeFile(join(directory, "pack.yaml"), "name: test-pack\nversion: 1.0.0\n");
    await mkdir(join(directory, "practices"));
    await writeFile(
      join(directory, "practices", "api-layer.md"),
      [
        "---",
        "id: api.layered-client",
        "title: Layer the API client",
        "stage: api-layer",
        "tech_stack:",
        "  - react",
        "  - typescript",
        "applies_when: building an API layer in a React SPA",
        "---",
        "Put HTTP calls behind a client module.",
        "",
      ].join("\n"),
    );

    const queryStdout = new MemoryWriter();
    expect(
      await run(["query", directory, "--query", "api layer"], { runtime, stdout: queryStdout }),
    ).toBe(0);
    expect(JSON.parse(queryStdout.value)).toMatchObject({
      command: "query",
      ok: true,
      data: { total: 1, results: [{ id: "api.layered-client" }] },
    });

    const getStdout = new MemoryWriter();
    expect(
      await run(["get", directory, "api.layered-client"], { runtime, stdout: getStdout }),
    ).toBe(0);
    expect(JSON.parse(getStdout.value)).toMatchObject({
      command: "get",
      ok: true,
      data: { id: "api.layered-client", body: "Put HTTP calls behind a client module.\n" },
    });

    const missingStdout = new MemoryWriter();
    expect(await run(["get", directory, "api.missing"], { runtime, stdout: missingStdout })).toBe(
      2,
    );
    expect(JSON.parse(missingStdout.value)).toMatchObject({
      command: "get",
      error: { code: "get.unknown_practice" },
      ok: false,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
