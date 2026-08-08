import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function runtimeForDecisions(decisions: unknown) {
  return createRuntime({
    packLoader: {
      async load() {
        return { pack: { name: "test-pack", version: "1.0.0" }, practices: [], decisions };
      },
    },
  });
}

test("evaluates a decision through the CLI protocol", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForDecisions([
    {
      branches: [
        {
          reason: "Redux scales",
          recommend: ["react.state.redux"],
          when: 'state.client == "heavy"',
        },
      ],
      id: "state.client-vs-server",
      question: "How much client state?",
    },
  ]);

  expect(
    await run(
      [
        "decide",
        "pack",
        "--decision",
        "state.client-vs-server",
        "--context",
        '{"state":{"client":"heavy"}}',
      ],
      { runtime, stdout },
    ),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      entryDecision: "state.client-vs-server",
      recommendations: [{ practiceId: "react.state.redux", reasons: ["Redux scales"] }],
      status: "matched",
    },
  });
  const resultSchema = (describeCommand("decide") as { resultSchema: JsonSchema }).resultSchema;
  expect(validateJsonSchema(JSON.parse(stdout.value).data, resultSchema)).toEqual([]);
});

test("renders the same decision data without the JSON envelope in human mode", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForDecisions([
    {
      branches: [
        {
          reason: "Redux scales",
          recommend: ["react.state.redux"],
          when: 'state.client == "heavy"',
        },
      ],
      id: "state.client-vs-server",
      question: "How much client state?",
    },
  ]);

  expect(
    await run(
      [
        "decide",
        "pack",
        "--decision",
        "state.client-vs-server",
        "--context",
        '{"state":{"client":"heavy"}}',
        "--human",
      ],
      { runtime, stdout },
    ),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({ status: "matched" });
  expect(stdout.value).not.toContain('"protocolVersion"');
});

test("returns no_match for a pack without decisions", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForDecisions([]);

  expect(
    await run(["decide", "pack", "--decision", "state.client-vs-server", "--context", "{}"], {
      runtime,
      stdout,
    }),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      noMatchReason: "pack has no decisions",
      recommendations: [],
      status: "no_match",
    },
  });
});

test("returns no_match for an empty decisions document", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForDecisions(null);

  expect(
    await run(["decide", "pack", "--decision", "state.client-vs-server", "--context", "{}"], {
      runtime,
      stdout,
    }),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      noMatchReason: "pack has no decisions",
      recommendations: [],
      status: "no_match",
    },
  });
});

test("maps a non-array decisions document to pack.parse_error", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForDecisions({
    branches: [],
    id: "state.client-vs-server",
    question: "How much client state?",
  });

  expect(
    await run(["decide", "pack", "--decision", "state.client-vs-server", "--context", "{}"], {
      runtime,
      stdout,
    }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    error: {
      code: "pack.parse_error",
      message: "The decisions document is not a list of decision nodes.",
    },
    ok: false,
  });
});

test("maps invalid context and evaluator errors to declared protocol errors", async () => {
  const invalidContext = new MemoryWriter();
  expect(
    await run(["decide", "pack", "--decision", "state.entry", "--context", "not-json"], {
      runtime: runtimeForDecisions([]),
      stdout: invalidContext,
    }),
  ).toBe(2);
  expect(JSON.parse(invalidContext.value)).toMatchObject({
    command: "decide",
    error: { code: "usage.invalid" },
    ok: false,
  });

  const unknownDecision = new MemoryWriter();
  expect(
    await run(["decide", "pack", "--decision", "state.missing", "--context", "{}"], {
      runtime: runtimeForDecisions([{ branches: [], id: "state.entry", question: "What now?" }]),
      stdout: unknownDecision,
    }),
  ).toBe(2);
  expect(JSON.parse(unknownDecision.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.unknown_decision" },
    ok: false,
  });
});

test("does not treat a rejected option value as human mode", async () => {
  const stdout = new MemoryWriter();

  expect(
    await run(["decide", "pack", "--context", "--human", "--decision", "state.entry"], {
      runtime: runtimeForDecisions([]),
      stdout,
    }),
  ).toBe(2);
  expect(stdout.value).not.toContain("Error:");
  expect(JSON.parse(stdout.value)).toMatchObject({
    error: { code: "usage.invalid" },
    ok: false,
  });
});

test("renders invalid invocations in human mode when --human is passed", async () => {
  const stdout = new MemoryWriter();

  expect(
    await run(["decide", "--human"], {
      runtime: runtimeForDecisions([]),
      stdout,
    }),
  ).toBe(2);
  expect(stdout.value).toContain("Error:");
  expect(stdout.value).not.toContain('"protocolVersion"');
});

test("rejects duplicate decision ids instead of silently choosing one", async () => {
  const stdout = new MemoryWriter();

  expect(
    await run(["decide", "pack", "--decision", "state.entry", "--context", "{}"], {
      runtime: runtimeForDecisions([
        { branches: [], id: "state.entry", question: "What now?" },
        { branches: [], id: "state.entry", question: "Ambiguous duplicate?" },
      ]),
      stdout,
    }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.duplicate_decision" },
    ok: false,
  });
});

test("returns dangling practice recommendations as-authored without pre-validation", async () => {
  const stdout = new MemoryWriter();
  const runtime = runtimeForDecisions([
    {
      branches: [
        {
          reason: "Redux scales",
          recommend: ["react.state.missing"],
          when: 'state.client == "heavy"',
        },
      ],
      id: "state.client-vs-server",
      question: "How much client state?",
    },
  ]);

  expect(
    await run(
      [
        "decide",
        "pack",
        "--decision",
        "state.client-vs-server",
        "--context",
        '{"state":{"client":"heavy"}}',
      ],
      { runtime, stdout },
    ),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    ok: true,
    data: {
      recommendations: [{ practiceId: "react.state.missing" }],
      status: "matched",
    },
  });
});

test("validates context before attempting to load the pack", async () => {
  let loadCalled = false;
  const stdout = new MemoryWriter();
  const runtime = createRuntime({
    packLoader: {
      async load() {
        loadCalled = true;
        throw new Error("pack should not be loaded");
      },
    },
  });

  expect(
    await run(["decide", "pack", "--decision", "state.entry", "--context", "not-json"], {
      runtime,
      stdout,
    }),
  ).toBe(2);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "decide",
    error: { code: "usage.invalid" },
    ok: false,
  });
  expect(loadCalled).toBe(false);
});

test("evaluates a real explicit pack directory through the node loader", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-decide-"));
  const stdout = new MemoryWriter();
  const runtime = createRuntime();

  try {
    await writeFile(join(directory, "pack.yaml"), "name: test-pack\nversion: 1.0.0\n");
    const decisionsYaml = [
      "- id: state.client-vs-server",
      "  question: How much client state?",
      "  branches:",
      "    - when: 'state.client == \"heavy\"'",
      "      recommend: [react.state.redux]",
      "      reason: Redux scales",
      "",
    ].join("\n");
    await writeFile(join(directory, "decisions.yaml"), decisionsYaml);

    expect(
      await run(
        [
          "decide",
          directory,
          "--decision",
          "state.client-vs-server",
          "--context",
          '{"state":{"client":"heavy"}}',
        ],
        { runtime, stdout },
      ),
    ).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "decide",
      data: {
        recommendations: [{ practiceId: "react.state.redux" }],
        status: "matched",
      },
      ok: true,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("treats an empty decisions document in a real pack as no_match", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lorelum-decide-"));
  const stdout = new MemoryWriter();
  const runtime = createRuntime();

  try {
    await writeFile(join(directory, "pack.yaml"), "name: test-pack\nversion: 1.0.0\n");
    await writeFile(join(directory, "decisions.yaml"), "");

    expect(
      await run(["decide", directory, "--decision", "state.entry", "--context", "{}"], {
        runtime,
        stdout,
      }),
    ).toBe(0);
    expect(JSON.parse(stdout.value)).toMatchObject({
      command: "decide",
      ok: true,
      data: {
        noMatchReason: "pack has no decisions",
        recommendations: [],
        status: "no_match",
      },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("maps invalid conditions and runtime cycles to their protocol errors", async () => {
  const invalidCondition = new MemoryWriter();
  expect(
    await run(["decide", "pack", "--decision", "state.entry", "--context", "{}"], {
      runtime: runtimeForDecisions([
        {
          branches: [{ reason: "Invalid", recommend: [], when: "state.client = heavy" }],
          id: "state.entry",
          question: "What now?",
        },
      ]),
      stdout: invalidCondition,
    }),
  ).toBe(2);
  expect(JSON.parse(invalidCondition.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.invalid_condition" },
    ok: false,
  });

  const cycle = new MemoryWriter();
  expect(
    await run(["decide", "pack", "--decision", "state.entry", "--context", '{"enabled":true}'], {
      runtime: runtimeForDecisions([
        {
          branches: [{ next: "state.loop", reason: "Loop", recommend: [], when: "enabled" }],
          id: "state.entry",
          question: "Start?",
        },
        {
          branches: [{ next: "state.entry", reason: "Loop", recommend: [], when: "enabled" }],
          id: "state.loop",
          question: "Continue?",
        },
      ]),
      stdout: cycle,
    }),
  ).toBe(2);
  expect(JSON.parse(cycle.value)).toMatchObject({
    command: "decide",
    error: { code: "decide.cycle" },
    ok: false,
  });
});
