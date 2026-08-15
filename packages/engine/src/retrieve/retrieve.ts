import type { Practice } from "@lorelum/format";

import type {
  RetrievePracticesInput,
  RetrievePracticesResult,
  RetrievedPractice,
} from "./types.js";

const defaultTopK = 5;
const maxTopK = 50;

/**
 * Minimal deterministic retrieval: metadata + text token matching with no
 * embeddings or external services. Same input always produces the same
 * ranking; ties break by practice id ascending.
 */
export function retrievePractices(input: RetrievePracticesInput): RetrievePracticesResult {
  const topK = normalizeTopK(input.topK);
  const tokens = normalizeTokens(input.query);
  if (tokens.length === 0) {
    return { query: input.query, k: topK, total: 0, results: [] };
  }

  const matches = input.practices
    .map((practice) => ({ practice, score: scorePractice(practice, tokens) }))
    .filter((match) => match.score > 0)
    .sort(compareMatches);

  return {
    query: input.query,
    k: topK,
    total: matches.length,
    results: matches
      .slice(0, topK)
      .map((match) => toRetrieved(match.practice, input.includeBody === true)),
  };
}

/** Field weights: title and applies_when are the recall core (ADR 0003). */
const scoredFields = [
  { weight: 3, text: (practice: Practice) => practice.title },
  { weight: 2, text: (practice: Practice) => practice.applies_when },
  { weight: 1, text: (practice: Practice) => practice.stage },
  { weight: 1, text: (practice: Practice) => practice.tech_stack.join(" ") },
  { weight: 1, text: (practice: Practice) => practice.body ?? "" },
] as const;

function scorePractice(practice: Practice, tokens: readonly string[]): number {
  const distinct = new Set(tokens);
  let score = 0;
  for (const field of scoredFields) {
    const haystack = new Set(normalizeTokens(field.text(practice)));
    for (const token of distinct) {
      if (haystack.has(token)) score += field.weight;
    }
  }
  return score;
}

function compareMatches(
  left: { practice: Practice; score: number },
  right: { practice: Practice; score: number },
): number {
  if (left.score !== right.score) return right.score - left.score;
  if (left.practice.id < right.practice.id) return -1;
  if (left.practice.id > right.practice.id) return 1;
  return 0;
}

function toRetrieved(practice: Practice, includeBody: boolean): RetrievedPractice {
  return {
    id: practice.id,
    title: practice.title,
    stage: practice.stage,
    tech_stack: [...practice.tech_stack],
    applies_when: practice.applies_when,
    ...(includeBody && practice.body !== undefined ? { body: practice.body } : {}),
  };
}

/**
 * Deterministic tokenization: Latin/numbers stay whole word tokens; CJK runs
 * split into overlapping bigrams so short Chinese queries match contiguous
 * Chinese text without a segmentation dependency.
 */
function normalizeTokens(text: string): string[] {
  const tokens: string[] = [];
  for (const run of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (isCjkRun(run)) {
      if (run.length === 1) tokens.push(run);
      for (let index = 0; index < run.length - 1; index += 1) {
        tokens.push(run.slice(index, index + 2));
      }
    } else {
      tokens.push(run);
    }
  }
  return tokens;
}

/** Han/Kana runs are bigram-segmented; other scripts stay whole words. */
function isCjkRun(text: string): boolean {
  return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(text);
}

function normalizeTopK(value: number | undefined): number {
  const topK = Number.isInteger(value) ? (value as number) : defaultTopK;
  return Math.min(Math.max(topK, 1), maxTopK);
}
