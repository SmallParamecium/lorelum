import { BACKEND_ROUTES } from "../../protocol/constants";
import { BackendError, backendErrorBody, errorSchema } from "../../protocol/errors";
import { Elysia, status } from "elysia";
import { requireJson, reject } from "../../plugins/local-auth";
import { EmbeddingError } from "../embedding/errors";
import {
  StoreBusyError,
  StoreRecoveryRequiredError,
  defaultQueryArtifactCacheRoot,
} from "@lorelum/engine";
import {
  indexMutationSchema,
  indexOperationParamsSchema,
  indexOperationSchema,
  indexStatusQuerySchema,
  indexStatusSchema,
} from "./model";
import type {
  ContentAddressedSemanticRuntimePort,
  ContentAddressedTargetRequest,
} from "../query/content-addressed-semantic-runtime";

/** HTTP/authentication adapter for a Backend-hosted Engine semantic index service. */
export function indexController(
  runtime: ContentAddressedSemanticRuntimePort,
  available: () => boolean,
) {
  return new Elysia({ normalize: false })
    .onBeforeHandle(({ request }) => {
      if (!available()) return reject(503, "backend.busy");
      if (request.method === "POST") return requireJson(request);
    })
    .get(
      BACKEND_ROUTES.indexStatus,
      async ({ query }) => {
        try {
          return await runtime.indexStatus({ rootPath: query.storageRoot }, targetForStatus(query));
        } catch (error) {
          return indexFailure(error);
        }
      },
      {
        query: indexStatusQuerySchema,
        response: { 200: indexStatusSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .post(
      BACKEND_ROUTES.indexBuild,
      async ({ body }) => {
        try {
          return status(
            202,
            await runtime.build({ rootPath: body.storageRoot }, targetForMutation(body)),
          );
        } catch (error) {
          return indexFailure(error);
        }
      },
      {
        body: indexMutationSchema,
        response: { 202: indexOperationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .post(
      BACKEND_ROUTES.indexRebuild,
      async ({ body }) => {
        try {
          return status(
            202,
            await runtime.rebuild({ rootPath: body.storageRoot }, targetForMutation(body)),
          );
        } catch (error) {
          return indexFailure(error);
        }
      },
      {
        body: indexMutationSchema,
        response: { 202: indexOperationSchema, 400: errorSchema, 503: errorSchema },
      },
    )
    .get(
      BACKEND_ROUTES.indexOperation,
      async ({ params }) => {
        const operation = await runtime.indexOperation(params.operationId);
        return operation === undefined
          ? status(410, backendErrorBody("backend.operation-expired"))
          : operation;
      },
      {
        params: indexOperationParamsSchema,
        response: { 200: indexOperationSchema, 400: errorSchema, 410: errorSchema },
      },
    );
}

function targetForStatus(input: {
  readonly cacheRoot?: string | undefined;
  readonly projectRoot?: string | undefined;
  readonly projectStartDirectory?: string | undefined;
}): ContentAddressedTargetRequest {
  const cacheRoot = input.cacheRoot ?? defaultQueryArtifactCacheRoot();
  if (input.projectRoot !== undefined || input.projectStartDirectory !== undefined) {
    return Object.freeze({
      kind: "project",
      cacheRoot,
      ...(input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }),
      ...(input.projectStartDirectory === undefined
        ? {}
        : { startDirectory: input.projectStartDirectory }),
    });
  }
  return Object.freeze({ kind: "store", cacheRoot });
}

function targetForMutation(input: {
  readonly projectContext?:
    | {
        readonly cacheRoot: string;
        readonly projectRoot?: string | undefined;
        readonly startDirectory?: string | undefined;
      }
    | undefined;
  readonly cacheRoot?: string | undefined;
}): ContentAddressedTargetRequest {
  if (input.projectContext !== undefined) {
    return Object.freeze({
      kind: "project",
      cacheRoot: input.projectContext.cacheRoot,
      ...(input.projectContext.projectRoot === undefined
        ? {}
        : { projectRoot: input.projectContext.projectRoot }),
      ...(input.projectContext.startDirectory === undefined
        ? {}
        : { startDirectory: input.projectContext.startDirectory }),
    });
  }
  return Object.freeze({
    kind: "store",
    cacheRoot: input.cacheRoot ?? defaultQueryArtifactCacheRoot(),
  });
}

function indexFailure(error: unknown) {
  if (error instanceof EmbeddingError) {
    return status(503, { error: { code: error.code, message: error.message } });
  }
  if (error instanceof StoreBusyError)
    return status(503, domainError("store.busy", "The local Pack store is busy."));
  if (error instanceof StoreRecoveryRequiredError)
    return status(
      503,
      domainError("store.recovery-required", "The local Pack store requires recovery."),
    );
  return status(
    503,
    backendErrorBody(error instanceof BackendError ? error.code : "backend.failed"),
  );
}

function domainError(code: string, message: string) {
  return { error: { code, message } };
}
