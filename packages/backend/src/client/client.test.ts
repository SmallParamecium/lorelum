import { afterEach, describe, expect, test } from "bun:test";

import type { QueryRequest, QueryService, StorageRoot } from "@lorelum/engine";

import { createBackendApp } from "../app";
import { createEmbeddingService, type EmbeddingService } from "../modules/embedding/service";
import { createBackendService } from "../modules/backend/service";
import type { InstanceIdentity } from "../protocol/identity";
import { BackendRemoteError } from "../protocol/errors";
import { EmbeddingError } from "../modules/embedding/errors";
import { EMBEDDING_MODEL, ENCODING_ID } from "../modules/embedding/model";
import { PROTOCOL_VERSION } from "../protocol/constants";
import { DEFAULT_BACKEND_SETTINGS } from "../config/model";
import { createBackendClient } from "./client";
import { createContentAddressedSemanticRuntimeStub } from "../modules/query/content-addressed-semantic-runtime.test-helper";
import type { ContentAddressedSemanticRuntimePort } from "../modules/query/content-addressed-semantic-runtime";

const identity = Object.freeze({
  instanceId: "test-instance",
  buildIdentity: "test-build",
  protocolVersion: PROTOCOL_VERSION,
});
const secret = "a secret used only by tests";
const apps: Array<ReturnType<typeof createBackendApp>> = [];

afterEach(() => {
  for (const app of apps.splice(0)) app.stop(true);
});

function runningApp(
  keywordQueryService?: QueryService,
  backendIdentity: InstanceIdentity = identity,
  embedding?: EmbeddingService,
  semanticRuntime: ContentAddressedSemanticRuntimePort = createContentAddressedSemanticRuntimeStub(),
): {
  readonly app: ReturnType<typeof createBackendApp>;
  readonly url: string;
} {
  const keywordService: QueryService = keywordQueryService ?? {
    async query() {
      return { mode: "keyword", results: [] } as const;
    },
  };
  const app = createBackendApp({
    backend: createBackendService({ identity: backendIdentity, secret, onStop: () => undefined }),
    ...(embedding === undefined ? {} : { embedding }),
    keywordQueryService: keywordService,
    semanticRuntime,
  });
  apps.push(app);
  app.listen({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: 65_536 });
  if (app.server === null) throw new Error("test server did not start");
  return { app, url: `http://127.0.0.1:${app.server.port}` };
}

describe("createBackendClient", () => {
  test("configured preparation returns before transfer completion and explicit load joins it", async () => {
    let finish!: (value: string) => void;
    const transfer = new Promise<string>((resolve) => {
      finish = resolve;
    });
    let prepares = 0;
    const service = createEmbeddingService({
      settings: DEFAULT_BACKEND_SETTINGS,
      prepareModel: async (_signal, progress) => {
        prepares++;
        progress({ phase: "downloading" });
        return transfer;
      },
      createRuntime: () => ({
        start: async () => {},
        stop: async () => {},
        encode: async () => [],
        exited: new Promise<void>(() => {}),
      }),
    });
    const { url } = runningApp(undefined, identity, service);
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    const accepted = await client.beginModelPreparation();
    expect(accepted.status.state).toBe("loading");
    expect((await client.beginModelPreparation()).preparationId).toBe(accepted.preparationId);
    const explicit = client.loadModel();
    expect((await client.modelPreparation(accepted.preparationId)).status.state).toBe("loading");
    finish("fixture");
    expect((await explicit).state).toBe("ready");
    expect((await client.modelPreparation(accepted.preparationId)).status.state).toBe("ready");
    expect(prepares).toBe(1);
    await client.unloadModel();
    await expect(client.modelPreparation(accepted.preparationId)).rejects.toMatchObject({
      code: "embedding.preparation-expired",
    });
    await expect(client.modelPreparation("invalid")).rejects.toMatchObject({
      code: "backend.invalid-request",
    });
  });

  test("rejects a changed preparation handle instead of following another load", async () => {
    const expectedId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const replacementId = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
    const loading = {
      state: "loading" as const,
      encodingId: ENCODING_ID,
      device: "cpu" as const,
      dimensions: EMBEDDING_MODEL.dimensions,
      threads: 4,
    };
    const ready = { ...loading, state: "ready" as const };
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation: () => ({ preparationId: expectedId, status: loading }),
      modelPreparation: (preparationId) => {
        expect(preparationId).toBe(expectedId);
        return { preparationId: replacementId, status: ready };
      },
      waitModelPreparation: async () => ready,
      status: () => loading,
      beginLoad: () => loading,
      load: async () => loading,
      unload: async () => ({ ...ready, state: "unloaded" }),
      embed: async () => ({ encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] }),
      embedQuery: async () => ({ encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] }),
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    await expect(client.modelPreparation(expectedId)).rejects.toMatchObject({
      code: "embedding.preparation-expired",
    });
  });
  test("authenticates the service before making a strict-build query", async () => {
    const calls: unknown[] = [];
    const { url } = runningApp({
      async query(root, request) {
        calls.push({ root, request });
        return { mode: "keyword", results: [] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search", mode: "keyword" }),
    ).resolves.toEqual({
      mode: "keyword",
      results: [],
    });
    expect(calls).toEqual([
      { root: { rootPath: "/tmp/lorelum-client-test" }, request: { text: "search" } },
    ]);
  });

  test("does not send ordinary requests to a service with a different build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "different-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search", mode: "keyword" }),
    ).rejects.toEqual(expect.objectContaining({ code: "backend.build-mismatch" }));
    await expect(client.statusModel()).rejects.toEqual(
      expect.objectContaining({ code: "backend.build-mismatch" }),
    );
  });

  test("stops an authenticated service with a different build", async () => {
    const { url } = runningApp();
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "different-build",
      baseUrl: url,
    });

    await expect(client.stop()).resolves.toMatchObject({
      state: "stopping",
      instanceId: identity.instanceId,
      buildIdentity: identity.buildIdentity,
    });
  });

  test("preserves the established domain error code from a query response", async () => {
    const { url } = runningApp({
      async query() {
        throw new (await import("@lorelum/engine")).InvalidQueryRequestError();
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: "test-build",
      baseUrl: url,
    });

    await expect(
      client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "search", mode: "keyword" }),
    ).rejects.toBeInstanceOf(BackendRemoteError);
  });

  test("rejects non-loopback client URLs", () => {
    expect(() =>
      createBackendClient({
        identity,
        secret,
        buildIdentity: "test-build",
        baseUrl: "http://example.test",
      }),
    ).toThrow(TypeError);
    expect(() =>
      createBackendClient({
        identity,
        secret,
        buildIdentity: "test-build",
        baseUrl: "http://localhost:26186/query",
      }),
    ).toThrow(TypeError);
  });

  test("loads, reports, unloads, and embeds through the authenticated model contract", async () => {
    const calls: string[] = [];
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation() {
        return { preparationId: crypto.randomUUID(), status: this.status() };
      },
      modelPreparation(preparationId) {
        return { preparationId, status: this.status() };
      },
      async waitModelPreparation() {
        return this.status();
      },
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      beginLoad() {
        calls.push("load");
        return this.status();
      },
      embedQuery(inputs) {
        return this.embed("query", inputs);
      },
      async load() {
        return this.status();
      },
      async unload() {
        calls.push("unload");
        return { ...this.status(), state: "unloaded" };
      },
      async embed(kind, inputs) {
        calls.push(`${kind}:${inputs.length}`);
        return { encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });

    await expect(client.statusModel()).resolves.toMatchObject({ state: "ready" });
    await expect(client.loadModel()).resolves.toMatchObject({ state: "ready" });
    await expect(client.unloadModel()).resolves.toMatchObject({ state: "unloaded" });
    await expect(client.embed("query", ["hello"])).resolves.toMatchObject({
      encodingId: ENCODING_ID,
    });
    expect(calls).toEqual(["load", "unload", "query:1"]);
  });

  test("load polls asynchronous preparation beyond the native startup budget and maps failure", async () => {
    const phases: string[] = [];
    const embedding = createEmbeddingService({
      settings: { ...DEFAULT_BACKEND_SETTINGS, startupTimeoutMs: 10 },
      prepareModel: async (_, progress) => {
        progress({ phase: "downloading", downloadedBytes: 10, totalBytes: 100 });
        await Bun.sleep(300);
        throw new EmbeddingError("embedding.download-failed");
      },
      createRuntime: () => {
        throw new Error("download must finish first");
      },
    });
    const { url } = runningApp(undefined, identity, embedding);
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      timeoutMs: 1000,
    });
    await expect(
      client.loadModel({ onProgress: (value) => phases.push(value.progress!.phase) }),
    ).rejects.toMatchObject({ code: "embedding.download-failed" });
    expect(phases).toContain("downloading");
    await expect(client.embed("query", Array(9).fill("x"))).rejects.toMatchObject({
      code: "embedding.input-invalid",
    });
  });

  test("uses shutdown timeout for model unload", async () => {
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation() {
        return { preparationId: crypto.randomUUID(), status: this.status() };
      },
      modelPreparation(preparationId) {
        return { preparationId, status: this.status() };
      },
      async waitModelPreparation() {
        return this.status();
      },
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      beginLoad() {
        return this.status();
      },
      embedQuery(inputs) {
        return this.embed("query", inputs);
      },
      async load() {
        return this.status();
      },
      async unload() {
        await Bun.sleep(100);
        return { ...this.status(), state: "unloaded" };
      },
      async embed() {
        return { encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] };
      },
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
      timeoutMs: 1_000,
      shutdownTimeoutMs: 10,
    });
    await expect(client.unloadModel()).rejects.toMatchObject({ code: "backend.deadline-exceeded" });
  });

  test("rejects an embedding response whose vector count differs from the input count", async () => {
    const { url } = runningApp(undefined, identity, {
      beginModelPreparation() {
        return { preparationId: crypto.randomUUID(), status: this.status() };
      },
      modelPreparation(preparationId) {
        return { preparationId, status: this.status() };
      },
      async waitModelPreparation() {
        return this.status();
      },
      status: () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      beginLoad() {
        return this.status();
      },
      embedQuery(inputs) {
        return this.embed("query", inputs);
      },
      load: async () => ({
        state: "ready",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      unload: async () => ({
        state: "unloaded",
        encodingId: ENCODING_ID,
        device: "cpu",
        dimensions: EMBEDDING_MODEL.dimensions,
        threads: 4,
      }),
      embed: async () => ({ encodingId: ENCODING_ID, vectors: [[1, ...Array(383).fill(0)]] }),
    });
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });
    await expect(client.embed("query", ["hello", "world"])).rejects.toMatchObject({
      code: "backend.failed",
    });
  });

  test("uses the authenticated semantic index operation contract", async () => {
    const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const { url } = runningApp(
      undefined,
      identity,
      undefined,
      createContentAddressedSemanticRuntimeStub({
        async indexStatus() {
          return { state: "missing", profileId: "a".repeat(64) };
        },
        async build() {
          return { operationId, state: "building" };
        },
        async rebuild() {
          return { operationId, state: "building" };
        },
        async indexOperation() {
          return {
            operationId,
            state: "ready",
            index: { state: "ready", profileId: "a".repeat(64), vectorCount: 1 },
          };
        },
      }),
    );
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });

    await expect(
      client.indexStatus({ rootPath: "/tmp/lorelum-index-client" }),
    ).resolves.toMatchObject({
      state: "missing",
    });
    await expect(client.buildIndex({ rootPath: "/tmp/lorelum-index-client" })).resolves.toEqual({
      operationId,
      state: "building",
    });
    await expect(client.indexOperation(operationId)).resolves.toMatchObject({
      state: "ready",
      index: { vectorCount: 1 },
    });
  });

  test("reports an index operation lost after a daemon restart as expired", async () => {
    const operationId = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const { url } = runningApp(
      undefined,
      identity,
      undefined,
      createContentAddressedSemanticRuntimeStub({
        async indexOperation() {
          return undefined;
        },
      }),
    );
    const client = createBackendClient({
      identity,
      secret,
      buildIdentity: identity.buildIdentity,
      baseUrl: url,
    });

    await expect(client.indexOperation(operationId)).rejects.toMatchObject({
      code: "backend.operation-expired",
    });
  });
});

test("rejects a mismatched protocol before sending control or model requests", async () => {
  const mismatchedIdentity = { ...identity, protocolVersion: PROTOCOL_VERSION + 1 };
  const { url } = runningApp(undefined, mismatchedIdentity);
  const client = createBackendClient({
    identity: mismatchedIdentity,
    secret,
    buildIdentity: "test-build",
    baseUrl: url,
  });
  await expect(client.status()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
  await expect(client.stop()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
  await expect(client.loadModel()).rejects.toMatchObject({ code: "backend.protocol-mismatch" });
  await expect(client.beginModelPreparation()).rejects.toMatchObject({
    code: "backend.protocol-mismatch",
  });
});

test("round-trips semantic query metadata", async () => {
  const calls: unknown[] = [];
  const { url } = runningApp(
    undefined,
    identity,
    undefined,
    createContentAddressedSemanticRuntimeStub({
      async query(_root: StorageRoot, _target, request: QueryRequest) {
        calls.push(request);
        return {
          mode: "semantic",
          profileId: "b".repeat(64),
          coverage: "complete" as const,
          results: [],
        };
      },
    }),
  );
  const client = createBackendClient({
    identity,
    secret,
    buildIdentity: identity.buildIdentity,
    baseUrl: url,
  });

  await expect(
    client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "meaning" }),
  ).resolves.toEqual({
    mode: "semantic",
    profileId: "b".repeat(64),
    coverage: "complete",
    results: [],
  });
  expect(calls).toEqual([{ text: "meaning" }]);
});

test("preserves semantic index errors through the client boundary", async () => {
  const { url } = runningApp(
    undefined,
    identity,
    undefined,
    createContentAddressedSemanticRuntimeStub({
      async query() {
        throw new (await import("@lorelum/engine")).SemanticIndexNotReadyError();
      },
    }),
  );
  const client = createBackendClient({
    identity,
    secret,
    buildIdentity: identity.buildIdentity,
    baseUrl: url,
  });

  await expect(
    client.query({ rootPath: "/tmp/lorelum-client-test" }, { text: "meaning" }),
  ).rejects.toMatchObject({ code: "semantic.index-not-ready" });
});
