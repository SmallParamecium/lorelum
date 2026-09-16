/* eslint-disable no-await-in-loop -- Native single-slot encoding is intentionally sequential. */
import { DEFAULT_EMBEDDING_SETTINGS } from "../../config/embedding";
import { createTimeoutSignal } from "../../lifecycle/timeout";
import { randomUUID } from "node:crypto";
import { waitForSettlement } from "../../lifecycle/deadline";
import type { BackendSettings } from "../../config/model";
import {
  embeddingRequestSchema,
  type ModelPreparation,
  type ModelProgress,
  type ModelStatus,
} from "./dto";
import { EmbeddingError, embeddingFailure, type EmbeddingErrorCode } from "./errors";
import {
  ENCODING_ID,
  EMBEDDING_MODEL,
  type EmbeddingRuntime,
  type EmbeddingResult,
  type ModelState,
} from "./model";

const SHUTDOWN_DRAIN_RESERVE_MS = 200;

export interface EmbeddingServiceOptions {
  readonly createRuntime: (modelPath?: string) => EmbeddingRuntime;
  readonly prepareModel?: (
    signal: AbortSignal,
    progress: (value: ModelProgress) => void,
  ) => Promise<string>;
  readonly threads?: number;
  readonly settings: BackendSettings;
  /** Publishes durable Backend activity before a preparation can begin. */
  readonly onPreparationActivityChange?: (active: boolean) => Promise<void>;
}
export function createEmbeddingService(options: EmbeddingServiceOptions) {
  const threads = options.threads ?? DEFAULT_EMBEDDING_SETTINGS.threads;
  const encodingId = ENCODING_ID;
  let progress: ModelProgress | undefined;
  let state: ModelState = "unloaded";
  let failure: EmbeddingErrorCode | undefined;
  let runtime: EmbeddingRuntime | undefined;
  let loading: Promise<ModelStatus> | undefined;
  let preparationId: string | undefined;
  let unloading: Promise<ModelStatus> | undefined;
  let inflight: Promise<EmbeddingResult> | undefined;
  let startup: AbortController | undefined;
  let unloadDeadline: number | undefined;
  const status = (): ModelStatus => ({
    state,
    encodingId,
    threads,
    ...(progress ? { progress } : {}),
    device: "cpu",
    dimensions: EMBEDDING_MODEL.dimensions,
    ...(failure ? { error: failure } : {}),
  });
  async function recycle(handle: EmbeddingRuntime, deadline: number) {
    await handle.stop(deadline);
    if (runtime === handle) runtime = undefined;
  }
  async function recover(error: EmbeddingError, handle?: EmbeddingRuntime): Promise<never> {
    progress = undefined;
    if (state !== "unloading") {
      state = "failed";
      failure = error.code;
    }
    if (handle) {
      try {
        await recycle(handle, unloadDeadline ?? Date.now() + options.settings.shutdownTimeoutMs);
      } catch (cleanupError) {
        // Keep the public operation error stable and retain ownership for a later cleanup retry.
        throw new EmbeddingError(error.code, { cause: new AggregateError([error, cleanupError]) });
      }
    }
    throw error;
  }
  function load(): Promise<ModelStatus> {
    if (state === "unloading") return Promise.reject(new EmbeddingError("embedding.busy"));
    if (loading) return loading;
    if (state === "ready") return Promise.resolve(status());
    if (runtime || inflight) return Promise.reject(new EmbeddingError("embedding.busy"));
    preparationId = randomUUID();
    state = "loading";
    progress = { phase: "resolving" };
    failure = undefined;
    startup = new AbortController();
    const signal = startup.signal;
    loading = Promise.resolve().then(async () => {
      let handle: EmbeddingRuntime | undefined;
      let activityPublished = false;
      try {
        if (options.onPreparationActivityChange !== undefined) {
          await options.onPreparationActivityChange(true);
          activityPublished = true;
        }
        signal.throwIfAborted();
        const modelPath = await options.prepareModel?.(signal, (value) => {
          if (state === "loading" && !signal.aborted) progress = value;
        });
        signal.throwIfAborted();
        progress = { phase: "starting" };
        handle = options.createRuntime(modelPath);
        runtime = handle;
        await handle.start(signal, Date.now() + options.settings.startupTimeoutMs);
        signal.throwIfAborted();
        if (state !== "loading") throw new EmbeddingError("embedding.busy");
        state = "ready";
        progress = undefined;
        const active = handle;
        void handle.exited.then(() => {
          if (runtime === active && state === "ready") {
            state = "failed";
            failure = "embedding.failed";
            runtime = undefined;
          }
        });
        return status();
      } catch (error) {
        return await recover(
          signal.aborted && state !== "unloading"
            ? new EmbeddingError("embedding.deadline-exceeded")
            : embeddingFailure(error),
          handle,
        );
      } finally {
        loading = undefined;
        if (activityPublished) {
          try {
            await options.onPreparationActivityChange?.(false);
          } catch {
            // A failed clear remains conservative: activity inspection will defer recovery.
          }
        }
      }
    });
    return loading;
  }
  function unload(
    deadline = Date.now() + options.settings.shutdownTimeoutMs,
  ): Promise<ModelStatus> {
    if (unloading) return unloading;
    state = "unloading";
    preparationId = undefined;
    progress = undefined;
    unloadDeadline = deadline;
    startup?.abort();
    unloading = Promise.resolve().then(async () => {
      try {
        // A submitted native request must finish or its owned process must exit.
        if (inflight) await waitForSettlement(inflight, deadline - SHUTDOWN_DRAIN_RESERVE_MS);
        const handle = runtime;
        if (handle) await recycle(handle, deadline);
        if (loading && !(await waitForSettlement(loading, deadline)))
          throw new EmbeddingError("embedding.deadline-exceeded");
        if (inflight && !(await waitForSettlement(inflight, deadline)))
          throw new EmbeddingError("embedding.deadline-exceeded");
        if (runtime) throw new EmbeddingError("embedding.deadline-exceeded");
        state = "unloaded";
        failure = undefined;
        return status();
      } catch (error) {
        state = "failed";
        failure = embeddingFailure(error).code;
        throw embeddingFailure(error);
      } finally {
        unloading = undefined;
        unloadDeadline = undefined;
      }
    });
    return unloading;
  }
  async function embed(kind: "query" | "document", inputs: readonly string[]) {
    if (!embeddingRequestSchema.safeParse({ kind, inputs }).success)
      throw new EmbeddingError("embedding.input-invalid");
    if (state === "loading" || state === "unloading" || inflight)
      throw new EmbeddingError("embedding.busy");
    if (state !== "ready" || !runtime) throw new EmbeddingError("embedding.not-loaded");
    const handle = runtime;
    const timeout = createTimeoutSignal(options.settings.requestTimeoutMs);
    const signal = timeout.signal;
    const work = async () => {
      try {
        const vectors: number[][] = [];
        for (const text of inputs) vectors.push(await handle.encode(text, signal));
        signal.throwIfAborted();
        if (runtime !== handle) throw new EmbeddingError("embedding.not-loaded");
        return { encodingId, vectors };
      } catch (error) {
        const visible = signal.aborted
          ? new EmbeddingError("embedding.deadline-exceeded")
          : embeddingFailure(error);
        return recover(visible, handle);
      }
    };
    inflight = work();
    try {
      return await inflight;
    } finally {
      inflight = undefined;
      timeout.dispose();
    }
  }
  function beginLoad(): ModelStatus {
    if (state === "unloading" || (!loading && state !== "ready" && (runtime || inflight)))
      throw new EmbeddingError("embedding.busy");
    // HTTP accepts immediately; the shared task owns its error/status until completion.
    void load().catch(() => {});
    return status();
  }
  function modelPreparation(id: string) {
    if (id !== preparationId) throw new EmbeddingError("embedding.preparation-expired");
    return { preparationId: id, status: status() };
  }
  function beginModelPreparation(): ModelPreparation {
    if (state === "failed") throw new EmbeddingError(failure ?? "embedding.failed");
    if (state === "unloading" || (!loading && state !== "ready" && (runtime || inflight)))
      throw new EmbeddingError("embedding.busy");
    void load().catch(() => {});
    preparationId ??= randomUUID();
    return { preparationId, status: status() };
  }
  async function waitModelPreparation(id: string): Promise<ModelStatus> {
    modelPreparation(id);
    if (loading) await loading;
    const current = modelPreparation(id).status;
    if (current.state === "failed") throw new EmbeddingError(current.error ?? "embedding.failed");
    if (current.state !== "ready") throw new EmbeddingError("embedding.not-loaded");
    return current;
  }
  function embedQuery(inputs: readonly string[]) {
    if (state === "loading") return Promise.reject(new EmbeddingError("embedding.not-loaded"));
    return embed("query", inputs);
  }
  return {
    status,
    beginLoad,
    load,
    unload,
    embed,
    embedQuery,
    beginModelPreparation,
    modelPreparation,
    waitModelPreparation,
  };
}
export type EmbeddingService = ReturnType<typeof createEmbeddingService>;
