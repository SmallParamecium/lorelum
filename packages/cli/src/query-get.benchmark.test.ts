import { expect, test } from "bun:test";
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

/** Real benchmark pack directory; see test-fixtures/benchmark-pack/README.md for provenance. */
const benchmarkPack = join(import.meta.dir, "../test-fixtures/benchmark-pack");

async function runQuery(args: readonly string[]): Promise<{ exitCode: number; data: unknown }> {
  const stdout = new MemoryWriter();
  const exitCode = await run(["query", benchmarkPack, ...args], {
    runtime: createRuntime(),
    stdout,
  });
  return { exitCode, data: JSON.parse(stdout.value).data };
}

test("ranks the layered-design practices first for an API-boundary query", async () => {
  const { exitCode, data } = await runQuery(["--query", "远程 API 分层 组件"]);
  expect(exitCode).toBe(0);
  const results = (data as { results: { id: string }[] }).results;
  expect(results[0]!.id).toBe("react.api.layered-design");
  expect(results.map((result) => result.id)).toContain("frontend.layered-design");

  const resultSchema = (describeCommand("query") as { resultSchema: JsonSchema }).resultSchema;
  expect(validateJsonSchema(data, resultSchema)).toEqual([]);
});

test("ranks the avatar practice first for an avatar-fallback query", async () => {
  const { exitCode, data } = await runQuery(["--query", "头像 图片 缺失 回退"]);
  expect(exitCode).toBe(0);
  expect((data as { results: { id: string }[] }).results[0]!.id).toBe(
    "react.avatar-fallback-rendering",
  );
});

test("ranks the pagination practice first for a pagination query", async () => {
  const { exitCode, data } = await runQuery(["--query", "列表 分页 page_size total"]);
  expect(exitCode).toBe(0);
  expect((data as { results: { id: string }[] }).results[0]!.id).toBe("api.pagination-convention");
});

test("returns an empty result for an unrelated query", async () => {
  const { exitCode, data } = await runQuery(["--query", "量子物理 引擎 拓扑"]);
  expect(exitCode).toBe(0);
  expect(data).toMatchObject({ total: 0, results: [] });
});

test("returns full bodies with --full", async () => {
  const { exitCode, data } = await runQuery(["--query", "头像 回退", "--full", "--top-k", "1"]);
  expect(exitCode).toBe(0);
  const result = (data as { results: { id: string; body?: string }[] }).results[0]!;
  expect(result.id).toBe("react.avatar-fallback-rendering");
  expect(result.body).toContain("常见反模式");
});

test("fetches one benchmark practice by id and maps unknown ids", async () => {
  const stdout = new MemoryWriter();
  expect(
    await run(["get", benchmarkPack, "react.command-domain-boundary"], {
      runtime: createRuntime(),
      stdout,
    }),
  ).toBe(0);
  expect(JSON.parse(stdout.value)).toMatchObject({
    command: "get",
    ok: true,
    data: { id: "react.command-domain-boundary", body: expect.stringContaining("命令") },
  });

  const missing = new MemoryWriter();
  expect(
    await run(["get", benchmarkPack, "react.missing"], {
      runtime: createRuntime(),
      stdout: missing,
    }),
  ).toBe(2);
  expect(JSON.parse(missing.value)).toMatchObject({
    command: "get",
    error: { code: "get.unknown_practice" },
    ok: false,
  });
});
