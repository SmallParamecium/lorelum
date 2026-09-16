import type { EffectivePractice } from "../../local-store";
import { parseQueryRequest } from "../request";
import { assembleQueryHits } from "../result";
import type { QueryRequest } from "../types";
import { validateEmbeddingBatch, type EmbeddingPort } from "./encoding";
import { SemanticIndexQueryError } from "./errors";
import type { SemanticCandidate, SemanticIndexReader } from "./index/reader";
import type { EmbeddingProfile } from "./profile";
import type { SemanticQueryResult } from "./query-service";

/** Execute the source-neutral reader/embedding half of a semantic query. */
export async function searchSemanticArtifact(input: {
  readonly reader: SemanticIndexReader;
  readonly profile: EmbeddingProfile;
  readonly embedding: EmbeddingPort;
  readonly request: QueryRequest;
  readonly excludedPracticeIds: ReadonlySet<string>;
}): Promise<readonly SemanticCandidate[]> {
  const request = parseQueryRequest(input.request);
  if (!input.reader.hasEligibleVectors(input.excludedPracticeIds)) return Object.freeze([]);
  const batch = await input.embedding.embed([request.text]);
  const [queryVector] = validateEmbeddingBatch(input.profile, [request.text], batch);
  if (queryVector === undefined) {
    throw new SemanticIndexQueryError("Embedding result did not contain a query vector");
  }
  return input.reader.search(queryVector, input.excludedPracticeIds, request.limit);
}

/** Assemble a public semantic result from rows already proven current by the caller. */
export function assembleSemanticArtifactResult(input: {
  readonly profile: EmbeddingProfile;
  readonly coverage: SemanticQueryResult["coverage"];
  readonly practices: readonly EffectivePractice[];
  readonly candidates: readonly SemanticCandidate[];
}): SemanticQueryResult {
  return Object.freeze({
    mode: "semantic",
    profileId: input.profile.profileId,
    coverage: input.coverage,
    results: assembleQueryHits(
      input.practices,
      input.candidates,
      (message) => new SemanticIndexQueryError(message),
    ),
  });
}
