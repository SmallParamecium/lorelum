import type { IndexOperation, IndexStatus } from "../index/model";
import type {
  ContentAddressedSemanticQueryResult,
  ContentAddressedSemanticRuntimePort,
  ContentAddressedTargetRequest,
} from "./content-addressed-semantic-runtime";
import type { QueryRequest, StorageRoot } from "@lorelum/engine";

const profileId = "a".repeat(64);

export function createContentAddressedSemanticRuntimeStub(
  overrides: Partial<ContentAddressedSemanticRuntimePort> = {},
): ContentAddressedSemanticRuntimePort {
  return {
    async query(
      _root: StorageRoot,
      _target: ContentAddressedTargetRequest,
      _query: QueryRequest,
      _policy,
    ): Promise<ContentAddressedSemanticQueryResult> {
      return {
        mode: "semantic",
        profileId,
        coverage: "complete",
        results: [],
      };
    },
    async indexStatus(): Promise<IndexStatus> {
      return { state: "missing", profileId };
    },
    async build(): Promise<IndexOperation> {
      return { operationId: crypto.randomUUID(), state: "building" };
    },
    async rebuild(): Promise<IndexOperation> {
      return { operationId: crypto.randomUUID(), state: "building" };
    },
    async indexOperation(): Promise<IndexOperation | undefined> {
      return undefined;
    },
    async waitForIdle(): Promise<void> {},
    ...overrides,
  };
}
