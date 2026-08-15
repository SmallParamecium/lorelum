# ADR 0008: lore query and get retrieval contract

- **Date:** 2026-08-15
- **Status:** Proposed
- **Related:** ADR 0003, ADR 0004, ADR 0005, ADR 0006, ADR 0007

## Context

The Practice schema from ADR 0003 and the local decision workflow from
ADR 0007 are already available, but the first workflow step is missing:
there is no engine retrieval implementation and no CLI command for reading
Practices from a pack. Callers would otherwise need to inspect a pack
directory and copy retrieval, ranking, and empty-result semantics into every
adapter.

The v1 command contract was finalized for the fork main model based on
ADR 0004, ADR 0005, and ADR 0006. The accepted scope is a deterministic,
offline retrieval path; embeddings, vectors, LocalStore, Registry, and MCP
integration remain later work.

## Decision

### Retrieval model

The engine exposes a pure `retrievePractices` function. It has no filesystem,
process I/O, network access, or external service dependency.

It matches normalized query tokens against Practice title, applies_when,
stage, tech_stack, and body. Results are ranked by descending match score,
with ties broken by ascending Practice id. The score itself is an
implementation detail and is not part of the result data. Same input always
produces the same result ordering.

This is the minimal deterministic model selected instead of:

- using a global LocalStore, which was not implemented on this fork baseline;
- adding embedding or vector retrieval, which belongs to the later engine
  E2/E3 work and introduces external dependencies and a different quality
  model;
- defining only an interface without runnable retrieval, which would leave
  the CLI command unusable.

### lore query

```text
lore query <pack-path> --query <text> [--top-k <n>] [--full]
```

- `pack-path` is an explicit v1 pack directory loaded through the ADR 0006
  loader.
- `--query` is required natural-language text. Empty text is
  `usage.invalid`.
- `--top-k` is optional, defaults to 5, and accepts integers from 1 through 50. Values outside that range are `usage.invalid`; they are not clamped.
- `--full` adds each result's body. Without it, results contain the Practice
  metadata fields `id`, `title`, `stage`, `tech_stack`, and
  `applies_when`.
- `total` is the number of matching Practices before `k` truncation.
- No matches return `total: 0` and `results: []` with exit code 0. Recall
  misses are not runtime errors.

The result data is:

```json
{
  "query": "build an API client",
  "k": 5,
  "total": 2,
  "results": [
    {
      "id": "api.layered-client",
      "title": "Layer the API client",
      "stage": "api-layer",
      "tech_stack": ["react", "typescript"],
      "applies_when": "building an API layer"
    }
  ]
}
```

### lore get

```text
lore get <pack-path> <practice-id>
```

- `pack-path` is an explicit v1 pack directory loaded through the ADR 0006
  loader.
- `practice-id` is the dotted Practice key declared by PracticeSchema.
- A successful result is one complete Practice as defined by
  PracticeSchema, including optional fields such as severity, body, and
  anti_patterns.
- An unknown id returns `get.unknown_practice` with exit code 2, parallel
  to `decide.unknown_decision`.

### Protocol and source of truth

Both commands follow the ADR 0004 JSON envelope by default. Global options
`--config`, `--log-level`, and `--human` are inherited from the fork CLI
registry. `--human` changes presentation only, not data or exit semantics.

The CLI registry owns the declared `resultSchema`, `errorCodes`, and
`exitCodes` metadata. Query metadata and complete Practice schemas are
derived from the format package's PracticeSchema rather than hand-copied
twice. Retrieval and ranking logic remains in the engine; CLI handlers only
decode arguments, load packs, and wire results.

```text
query errorCodes:
  [...configPathErrorCodes, "pack.path_invalid", "pack.unreadable", "pack.parse_error"]

get errorCodes:
  [...configPathErrorCodes, "pack.path_invalid", "pack.unreadable", "pack.parse_error",
   "get.unknown_practice"]
```

`usage.invalid` and `runtime.unexpected` remain inherited through
`configPathErrorCodes`; they are not copied into each command definition.

## Consequences

### Positive

- The query to get workflow is executable without network access or hidden
  state.
- Results are deterministic, auditable, and reusable by future MCP adapters
  through the engine function.
- Empty results and unknown ids have distinct, typed semantics.
- Command discovery exposes a stable schema for machine consumers without
  moving the existing decide contract out of its current layer.

### Accepted risk

- Text matching is intentionally less capable than embeddings. Recall and
  ranking will improve in later engine stages without changing this v1 CLI
  contract.
- Passing an explicit pack path on every call is more verbose than a global
  index. This avoids depending on unimplemented LocalStore lifecycle work.
- `--human` remains pretty JSON on this fork baseline rather than markdown
  rendering, truncation, or paging.

### Follow-ups

- Embedding and vector retrieval are engine E2/E3 work.
- LocalStore, install/search/update, Registry, and MCP tool wiring are later
  tasks.
- Migration from the fork registry model to the official main CLI model is a
  separate coordination item and is not mixed into this implementation.
- Structured filters, `--json`, `--expand`, and richer human rendering are
  deferred.

## References

- Issue: [SmallParamecium/lorelum#21](https://github.com/SmallParamecium/lorelum/issues/21)
- Contract research: `lore-query-get-最终调研报告.md`
- Related ADRs: 0003, 0004, 0005, 0006, 0007
