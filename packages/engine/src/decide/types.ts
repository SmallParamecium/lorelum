import type { DecisionNode } from "@lorelum/format";

/** Structured project context passed to the evaluator; dotted-path condition fields resolve from here. */
export type DecisionContext = Readonly<Record<string, unknown>>;

/** Aggregated result for one recommended Practice: the matched id plus all matched reasons. */
export interface DecisionRecommendation {
  /** Practice id referenced by the matched branch. */
  practiceId: string;
  /** Reasons given by each matched branch that recommends this Practice; merged across branches. */
  reasons: string[];
}

/** A single Decision Node visited along the evaluation path, for an auditable trace. */
export interface DecisionTraceEntry {
  /** id of the evaluated Decision Node. */
  decisionId: string;
  /** The node's question text. */
  question: string;
  /** The matched branch's when expression; null when no branch matched. */
  matchedWhen: string | null;
  /** Next Decision Node id chained by the matched branch; null at the end of the path. */
  nextDecision: string | null;
}

/** Successful result: at least one branch matched and produced recommendations (spec §2.2: not an error). */
export interface MatchedDecisionResult {
  /** Stable status marker distinguishing matched / no_match. */
  status: "matched";
  /** Entry Decision Node id passed by the caller. */
  entryDecision: string;
  /** Deduplicated, merged recommendation list along the path. */
  recommendations: DecisionRecommendation[];
  /** Full evaluation trace for audit and debugging. */
  trace: DecisionTraceEntry[];
}

/** Normal (non-error) termination: no branch matched the given context. */
export interface NoMatchDecisionResult {
  /** Stable status marker distinguishing matched / no_match. */
  status: "no_match";
  /** Entry Decision Node id passed by the caller. */
  entryDecision: string;
  /** Always empty under no_match. */
  recommendations: [];
  /** Evaluation trace up to the first unmatched node. */
  trace: DecisionTraceEntry[];
  /** Human-readable reason for no match, surfaced by the CLI. */
  noMatchReason: string;
}

/** Stable external result contract shared by the CLI and future MCP adapters. */
export type DecideResult = MatchedDecisionResult | NoMatchDecisionResult;

/** Input for a pure evaluation; no filesystem or process I/O, reusable by CLI and MCP. */
export interface DecisionEvaluationInput {
  /** Context snapshot used to evaluate when conditions. */
  context: DecisionContext;
  /** Decision Nodes to evaluate, usually from decisions.yaml. */
  decisions: readonly DecisionNode[];
  /** Decision Node id where evaluation starts. */
  entryDecision: string;
}

/** Typed evaluation failure; code is a stable protocol value mapped to CLI errorCodes. */
export class DecisionEvaluationError extends Error {
  constructor(
    readonly code:
      | "decide.cycle"
      | "decide.duplicate_decision"
      | "decide.invalid_condition"
      | "decide.unknown_decision",
    message: string,
  ) {
    super(message);
    this.name = "DecisionEvaluationError";
  }
}
