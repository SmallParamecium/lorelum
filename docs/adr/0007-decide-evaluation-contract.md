# ADR 0007: lore decide evaluation contract

- **Date:** 2026-08-04
- **Status:** Accepted
- **Related:** ADR 0003, ADR 0004, ADR 0006

## Context

Knowledge packs already define Decision Nodes in decisions.yaml, but the
runtime semantics for evaluating their when conditions and chaining next
edges were not part of the repository contract. The CLI is consumed by agents
and CI, so evaluation must be deterministic, replayable, safe for untrusted
pack text, and machine-readable.

## Decision

### Command input

The v1 command is:

```text
lore decide <pack-path> --decision <decision-id> --context <json>
```

pack-path is an explicit v1 pack directory loaded through the ADR 0006
loader. decision-id is a required entry node. context is a required JSON
object; it is decoded by the CLI before pack I/O begins.

### Condition language

branch.when uses a small expression language:

- dotted field paths, such as state.client;
- string, boolean, and number literals;
- ==, !=, &&, ||, !, and parentheses.

To keep evaluation bounded, expressions may nest unary operators and
parenthesized subexpressions to at most 128 levels and may contain at most
1024 binary operators (&& and ||) in total. Expressions that exceed either
limit are rejected as invalid conditions.

The language does not execute JavaScript, call functions, evaluate regular
expressions, or provide collection quantifiers. Invalid syntax returns
decide.invalid_condition with exit code 2.

Missing fields and type-incompatible subexpressions are evaluated safely as
false. They do not produce an error; if no branch matches, the command returns
no_match with exit code 0.

Before any branch is selected, every branch condition in the visited Decision
Node is parsed. Invalid syntax in a later branch therefore cannot be masked by
an earlier match; the command returns decide.invalid_condition. Conditions in
Decision Nodes that evaluation never reaches are not parsed.

### Path and result semantics

Branches are evaluated in declaration order and the first matching branch wins.
When a branch has next, evaluation continues at that Decision Node. A
Practice id is included once in recommendations, in first-seen order. If
multiple nodes recommend it, their reasons are appended in match order.
Runtime cycles return decide.cycle with exit code 2.

The result data is either:

```json
{
  "status": "matched",
  "entryDecision": "state.client-vs-server",
  "recommendations": [{ "practiceId": "react.state.redux", "reasons": ["Redux scales"] }],
  "trace": [
    {
      "decisionId": "state.client-vs-server",
      "question": "How much client state?",
      "matchedWhen": "state.client == \"heavy\"",
      "nextDecision": null
    }
  ]
}
```

or:

```json
{
  "status": "no_match",
  "entryDecision": "state.client-vs-server",
  "recommendations": [],
  "trace": [],
  "noMatchReason": "pack has no decisions"
}
```

No matching branch and a pack without decisions are successful no_match
results. An empty decisions document is treated the same as a missing one.
An unknown entry Decision Node returns decide.unknown_decision. Every
protocol response remains a JSON envelope by default; --human changes
presentation only and does not change data or exit semantics.

### Input validity semantics

decide does not require the pack to have already passed `lore validate`; it
defines runtime behavior for structurally ambiguous inputs instead of
silently picking an arbitrary result:

- An empty decisions document (YAML parsed as null) is normalized to an
  empty list and returns no_match with exit code 0, the same as a missing
  decisions.yaml.
- A decisions document that is present but is not a list of Decision Nodes
  returns pack.parse_error with exit code 2.
- Duplicate Decision ids return decide.duplicate_decision with exit code 2.
  A repeated id would make branch selection nondeterministic, so evaluation
  refuses to start.
- Dangling `recommend` Practice references are returned as-authored. The
  runtime does not fail the command; a consumer that resolves the id finds
  nothing, which is a recall-quality matter (ADR 0003 §2), not a runtime
  error. Pack authors still surface the reference through `lore validate` in
  CI.
- A dangling `next` reference surfaces as decide.unknown_decision when
  evaluation reaches that edge.

Runtime cycles remain decide.cycle with exit code 2. Packs with cycles are
also rejected by `lore validate` (ADR 0003), but decide does not pre-validate,
so the evaluator's own cycle guard is the contract for this command.

## Consequences

The evaluator is a pure engine function with no filesystem or process-I/O
dependency. The CLI and future MCP adapter can share the same behavior. Pack
authors get deterministic, auditable traces, while malformed or missing
context cannot execute arbitrary pack-provided code.

lore validate continues to validate structure, references, and cycles only;
checking when syntax is a separate follow-up and is not added to the v1
format validator by this ADR.
