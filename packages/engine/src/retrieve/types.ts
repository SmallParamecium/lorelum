import type { Practice } from "@lorelum/format";

/** One retrieved Practice; body is included only when requested. */
export type RetrievedPractice = {
  id: string;
  title: string;
  stage: string;
  tech_stack: readonly string[];
  applies_when: string;
  body?: string;
};

/** Stable deterministic retrieval result; `total` counts all matches, `results` is capped at k. */
export type RetrievePracticesResult = {
  query: string;
  k: number;
  total: number;
  results: readonly RetrievedPractice[];
};

export interface RetrievePracticesInput {
  practices: readonly Practice[];
  query: string;
  /** Result cap; default 5, clamped to 1..50. */
  topK?: number;
  /** Include the full body per result; default false. */
  includeBody?: boolean;
}
